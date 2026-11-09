import CryptoKit
import ExpoModulesCore
import Foundation
import Security

/// HTTPS client for talking to a Philips Hue bridge on the local network.
///
/// The bridge serves a certificate signed by Signify's own root CA, which iOS does
/// not trust, so `fetch` from React Native fails. This module evaluates the server
/// trust itself: on first contact (pairing) it accepts the certificate and reports
/// its SHA-256 fingerprint plus common name (which is the bridge ID); every later
/// call passes that fingerprint and the connection is refused if it changes.
public class HueHttpModule: Module {
  private var streams: [String: StreamTask] = [:]
  private let streamsLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("HueHttp")

    Events("onStreamData", "onStreamEnd")

    AsyncFunction("request") { (options: HueRequestOptions) async throws -> [String: Any] in
      guard let url = URL(string: options.url) else {
        throw HueHttpException("Invalid URL: \(options.url)")
      }
      var request = URLRequest(url: url, timeoutInterval: options.timeoutMs / 1000)
      request.httpMethod = options.method
      for (name, value) in options.headers {
        request.setValue(value, forHTTPHeaderField: name)
      }
      if let body = options.body {
        request.httpBody = body.data(using: .utf8)
        if request.value(forHTTPHeaderField: "Content-Type") == nil {
          request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
      }

      let delegate = PinningDelegate(
        pinnedFingerprint: options.pinnedFingerprint,
        expectedCommonName: options.expectedCommonName
      )
      let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
      defer { session.finishTasksAndInvalidate() }

      do {
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        var result: [String: Any] = [
          "status": status,
          "body": String(decoding: data, as: UTF8.self),
        ]
        if let cert = delegate.observed {
          result["fingerprint"] = cert.fingerprint
          result["commonName"] = cert.commonName ?? NSNull()
        }
        return result
      } catch {
        if let failure = delegate.failure {
          throw HueHttpException(failure)
        }
        throw HueHttpException(error.localizedDescription)
      }
    }

    AsyncFunction("startStream") { (id: String, options: HueRequestOptions) throws in
      guard let url = URL(string: options.url) else {
        throw HueHttpException("Invalid URL: \(options.url)")
      }
      var request = URLRequest(url: url)
      request.httpMethod = options.method
      request.timeoutInterval = options.timeoutMs / 1000
      for (name, value) in options.headers {
        request.setValue(value, forHTTPHeaderField: name)
      }

      let task = StreamTask(
        id: id,
        request: request,
        pinnedFingerprint: options.pinnedFingerprint,
        expectedCommonName: options.expectedCommonName,
        onChunk: { [weak self] chunk in
          self?.sendEvent("onStreamData", ["id": id, "chunk": chunk])
        },
        onEnd: { [weak self] error in
          self?.removeStream(id)
          self?.sendEvent("onStreamEnd", ["id": id, "error": error ?? NSNull()])
        }
      )
      self.stopStream(id)
      self.streamsLock.lock()
      self.streams[id] = task
      self.streamsLock.unlock()
      task.start()
    }

    Function("stopStream") { (id: String) in
      self.stopStream(id)
    }

    OnDestroy {
      self.streamsLock.lock()
      let all = Array(self.streams.values)
      self.streams.removeAll()
      self.streamsLock.unlock()
      all.forEach { $0.cancel() }
    }
  }

  private func stopStream(_ id: String) {
    streamsLock.lock()
    let task = streams.removeValue(forKey: id)
    streamsLock.unlock()
    task?.cancel()
  }

  private func removeStream(_ id: String) {
    streamsLock.lock()
    streams.removeValue(forKey: id)
    streamsLock.unlock()
  }
}

struct HueRequestOptions: Record {
  @Field var url: String = ""
  @Field var method: String = "GET"
  @Field var headers: [String: String] = [:]
  @Field var body: String? = nil
  /// Lower-case hex SHA-256 of the leaf certificate (DER). When set, any other certificate is refused.
  @Field var pinnedFingerprint: String? = nil
  /// When set, the leaf certificate's common name must match (case-insensitive). Hue uses the bridge ID.
  @Field var expectedCommonName: String? = nil
  @Field var timeoutMs: Double = 8000
}

final class HueHttpException: GenericException<String> {
  override var reason: String { param }
}

struct ObservedCertificate {
  let fingerprint: String
  let commonName: String?
}

final class PinningDelegate: NSObject, URLSessionDataDelegate {
  let pinnedFingerprint: String?
  let expectedCommonName: String?
  private(set) var observed: ObservedCertificate?
  private(set) var failure: String?

  init(pinnedFingerprint: String?, expectedCommonName: String?) {
    self.pinnedFingerprint = pinnedFingerprint?.lowercased()
    self.expectedCommonName = expectedCommonName?.lowercased()
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    handle(challenge, completionHandler: completionHandler)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    handle(challenge, completionHandler: completionHandler)
  }

  private func handle(
    _ challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      let leaf = chain.first
    else {
      completionHandler(.performDefaultHandling, nil)
      return
    }

    let der = SecCertificateCopyData(leaf) as Data
    let fingerprint = SHA256.hash(data: der).map { String(format: "%02x", $0) }.joined()
    var commonNameRef: CFString?
    SecCertificateCopyCommonName(leaf, &commonNameRef)
    let commonName = commonNameRef as String?
    observed = ObservedCertificate(fingerprint: fingerprint, commonName: commonName)

    if let pinned = pinnedFingerprint, pinned != fingerprint {
      failure = "CERT_MISMATCH: bridge certificate changed (expected \(pinned), got \(fingerprint))"
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    if let expected = expectedCommonName, expected != commonName?.lowercased() {
      failure = "CERT_MISMATCH: certificate is for \(commonName ?? "unknown"), expected \(expected)"
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }
}

/// A long-lived GET (Server-Sent Events) that forwards UTF-8 text chunks as they arrive.
final class StreamTask: PinningDelegate {
  let id: String
  private let request: URLRequest
  private let onChunk: (String) -> Void
  private let onEnd: (String?) -> Void
  private var session: URLSession?
  private var pending = Data()
  private var cancelled = false

  init(
    id: String,
    request: URLRequest,
    pinnedFingerprint: String?,
    expectedCommonName: String?,
    onChunk: @escaping (String) -> Void,
    onEnd: @escaping (String?) -> Void
  ) {
    self.id = id
    self.request = request
    self.onChunk = onChunk
    self.onEnd = onEnd
    super.init(pinnedFingerprint: pinnedFingerprint, expectedCommonName: expectedCommonName)
  }

  func start() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = request.timeoutInterval
    config.timeoutIntervalForResource = 24 * 60 * 60
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    self.session = session
    session.dataTask(with: request).resume()
  }

  func cancel() {
    cancelled = true
    session?.invalidateAndCancel()
    session = nil
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    pending.append(data)
    // A chunk can end in the middle of a multi-byte character: keep up to 3 bytes back.
    for keep in 0...min(3, pending.count) {
      let prefix = pending.prefix(pending.count - keep)
      if let text = String(data: prefix, encoding: .utf8) {
        pending = Data(pending.suffix(keep))
        if !text.isEmpty { onChunk(text) }
        return
      }
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    session.finishTasksAndInvalidate()
    if cancelled { return }
    if let failure = failure {
      onEnd(failure)
    } else if let http = task.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      onEnd("HTTP \(http.statusCode)")
    } else {
      onEnd(error?.localizedDescription)
    }
  }
}
