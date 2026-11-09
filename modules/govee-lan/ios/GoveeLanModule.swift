import ExpoModulesCore
import Foundation
import Network

/// Minimal UDP for the Govee LAN API, built on Network.framework.
///
/// Govee devices listen for a multicast "scan" on 239.255.255.250:4001, take commands on
/// unicast port 4003, and always reply to port 4002 on the sender, whatever port it sent from.
/// So this module offers: a listener on a fixed port, unicast send, and multicast send.
///
/// Multicast send needs the `com.apple.developer.networking.multicast` entitlement, which
/// Apple grants on request. Without it `sendMulticast` rejects with ERR_GOVEE_MULTICAST and
/// the app falls back to devices added by IP address.
public class GoveeLanModule: Module {
  private let queue = DispatchQueue(label: "ihome.govee-lan")
  private var listener: NWListener?
  private var listenerPort: UInt16?
  private var inbound: [ObjectIdentifier: NWConnection] = [:]
  private var outbound: [String: NWConnection] = [:]

  public func definition() -> ModuleDefinition {
    Name("GoveeLan")

    Events("onMessage", "onListenerError")

    AsyncFunction("startListening") { (port: Int) async throws in
      try await self.startListener(port: port)
    }

    Function("stopListening") {
      self.queue.async { self.stopListener() }
    }

    AsyncFunction("send") { (host: String, port: Int, message: String) async throws in
      try await self.send(host: host, port: port, message: message)
    }

    AsyncFunction("sendMulticast") { (group: String, port: Int, message: String) async throws in
      try await self.sendMulticast(group: group, port: port, message: message)
    }

    OnDestroy {
      self.queue.async {
        self.stopListener()
        self.outbound.values.forEach { $0.cancel() }
        self.outbound.removeAll()
      }
    }
  }

  // MARK: Listener

  private func startListener(port: Int) async throws {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
      throw GoveeLanException("Invalid port \(port)")
    }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        if self.listener != nil, self.listenerPort == nwPort.rawValue {
          continuation.resume()
          return
        }
        self.stopListener()

        let params = NWParameters.udp
        params.allowLocalEndpointReuse = true
        let listener: NWListener
        do {
          listener = try NWListener(using: params, on: nwPort)
        } catch {
          continuation.resume(throwing: GoveeLanException("ERR_GOVEE_LISTEN: \(error.localizedDescription)"))
          return
        }

        var settled = false
        listener.newConnectionHandler = { [weak self] connection in
          self?.accept(connection)
        }
        listener.stateUpdateHandler = { [weak self] state in
          switch state {
          case .ready:
            if !settled {
              settled = true
              continuation.resume()
            }
          case .failed(let error):
            listener.cancel()
            if !settled {
              settled = true
              continuation.resume(throwing: GoveeLanException("ERR_GOVEE_LISTEN: \(error.localizedDescription)"))
            } else {
              self?.sendEvent("onListenerError", ["error": error.localizedDescription])
            }
            self?.listener = nil
            self?.listenerPort = nil
          default:
            break
          }
        }
        self.listener = listener
        self.listenerPort = nwPort.rawValue
        listener.start(queue: self.queue)
      }
    }
  }

  private func stopListener() {
    listener?.cancel()
    listener = nil
    listenerPort = nil
    inbound.values.forEach { $0.cancel() }
    inbound.removeAll()
  }

  /// Each remote address that sends to the listener shows up as its own UDP "connection".
  private func accept(_ connection: NWConnection) {
    let key = ObjectIdentifier(connection)
    inbound[key] = connection
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.inbound.removeValue(forKey: key)
      default:
        break
      }
    }
    connection.start(queue: queue)
    receive(on: connection)
  }

  private func receive(on connection: NWConnection) {
    connection.receiveMessage { [weak self] data, _, _, error in
      guard let self = self else { return }
      if let data = data, let text = String(data: data, encoding: .utf8) {
        var host = ""
        var port = 0
        if case let .hostPort(remoteHost, remotePort) = connection.endpoint {
          host = Self.describe(remoteHost)
          port = Int(remotePort.rawValue)
        }
        self.sendEvent("onMessage", ["host": host, "port": port, "data": text])
      }
      if error == nil {
        self.receive(on: connection)
      }
    }
  }

  private static func describe(_ host: NWEndpoint.Host) -> String {
    let text: String
    switch host {
    case .ipv4(let address): text = "\(address)"
    case .ipv6(let address): text = "\(address)"
    case .name(let name, _): text = name
    @unknown default: text = "\(host)"
    }
    // Drop any interface scope suffix such as "%en0".
    return text.split(separator: "%").first.map(String.init) ?? text
  }

  // MARK: Unicast

  private func send(host: String, port: Int, message: String) async throws {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
      throw GoveeLanException("Invalid port \(port)")
    }
    let data = Data(message.utf8)
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        let key = "\(host):\(port)"
        let connection: NWConnection
        if let existing = self.outbound[key], Self.isUsable(existing.state) {
          connection = existing
        } else {
          self.outbound[key]?.cancel()
          connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .udp)
          connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection else { return }
            switch state {
            case .failed, .cancelled:
              if self.outbound[key] === connection { self.outbound.removeValue(forKey: key) }
            default:
              break
            }
          }
          self.outbound[key] = connection
          connection.start(queue: self.queue)
        }
        // Sends made before the connection is ready are queued by Network.framework.
        connection.send(content: data, completion: .contentProcessed { error in
          if let error = error {
            continuation.resume(throwing: GoveeLanException("ERR_GOVEE_SEND: \(error.localizedDescription)"))
          } else {
            continuation.resume()
          }
        })
      }
    }
  }

  private static func isUsable(_ state: NWConnection.State) -> Bool {
    switch state {
    case .setup, .preparing, .ready, .waiting: return true
    default: return false
    }
  }

  // MARK: Multicast

  private func sendMulticast(group: String, port: Int, message: String) async throws {
    guard let nwPort = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
      throw GoveeLanException("Invalid port \(port)")
    }
    let data = Data(message.utf8)
    let multicast: NWMulticastGroup
    do {
      multicast = try NWMulticastGroup(for: [.hostPort(host: NWEndpoint.Host(group), port: nwPort)])
    } catch {
      throw GoveeLanException("ERR_GOVEE_MULTICAST: \(error.localizedDescription)")
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      queue.async {
        let connectionGroup = NWConnectionGroup(with: multicast, using: .udp)
        var settled = false
        let finish: (Error?) -> Void = { error in
          guard !settled else { return }
          settled = true
          connectionGroup.cancel()
          if let error = error { continuation.resume(throwing: error) } else { continuation.resume() }
        }
        connectionGroup.stateUpdateHandler = { state in
          switch state {
          case .ready:
            connectionGroup.send(content: data) { error in
              finish(error.map { GoveeLanException("ERR_GOVEE_MULTICAST: \($0.localizedDescription)") })
            }
          case .failed(let error), .waiting(let error):
            // Without the multicast entitlement the group fails or waits with a permission error.
            finish(GoveeLanException("ERR_GOVEE_MULTICAST: \(error.localizedDescription)"))
          default:
            break
          }
        }
        connectionGroup.start(queue: self.queue)
        self.queue.asyncAfter(deadline: .now() + 3) {
          finish(GoveeLanException("ERR_GOVEE_MULTICAST: timed out"))
        }
      }
    }
  }
}

final class GoveeLanException: GenericException<String> {
  override var reason: String { param }
}
