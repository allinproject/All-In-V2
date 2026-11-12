// ALL-243 STAGED iOS companion source, not yet compiled into an iOS target.
// Requires a separately approved Apple App Attest attestation enrolment flow.
// This code never creates a phone trust record or internal HMAC certificate.
// Watch user must confirm the challenge on the watch itself.
import Foundation
import CryptoKit
import DeviceCheck
import WatchConnectivity

@available(iOS 16.0, *)
final class IPhoneWatchPairingCoordinator: NSObject, WCSessionDelegate {
    enum PairError: Error { case noPairedWatch, notReachable, invalidWatchReply, appNotAttested }
    private override init() { super.init() }
    static let shared = IPhoneWatchPairingCoordinator()

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    private func send(_ message: [String: Any]) async throws -> [String: Any] {
        guard WCSession.isSupported(), WCSession.default.isPaired else {
            throw PairError.noPairedWatch
        }
        guard WCSession.default.isWatchAppInstalled,
              WCSession.default.isReachable else {
            throw PairError.notReachable
        }
        return try await withCheckedThrowingContinuation { continuation in
            WCSession.default.sendMessage(message, replyHandler: { reply in
                continuation.resume(returning: reply)
            }, errorHandler: { err in
                continuation.resume(throwing: err)
            })
        }
    }
    private func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    private func decodeB64url(_ input: String) -> Data? {
        let input = input.replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        return Data(base64Encoded: input.padding(toLength: ((input.count+3)/4)*4,
                                               withPad: "=", startingAt: 0))
    }
    private func jsonPayload(_ fields: [String]) throws -> Data {
        try JSONSerialization.data(withJSONObject: fields, options: [.fragmentsAllowed])
    }
    struct WatchKey {
        let deviceRef: String
        let publicKeySpkiB64url: String
    }
    func fetchWatchKey() async throws -> WatchKey {
        let message = try await send(["action": "pairingKey"])
        guard let encoded = message["watchPublicKeySpkiB64url"] as? String,
              let spki = decodeB64url(encoded),
              spki.count == 91 else {
            throw PairError.invalidWatchReply
        }
        let fingerprint = SHA256.hash(data: spki)
            .map { String(format: "%02x", $0) }.joined()
        return WatchKey(deviceRef: "watch-key:" + fingerprint,
                        publicKeySpkiB64url: encoded)
    }
    struct SignedWatchRequest: Encodable {
        let challengeId: String
        let watchPublicKeySpkiB64url: String
        let watchSignatureB64url: String
        let phoneAppAttestKeyId: String
        let phoneAssertionCborB64url: String
    }
    // 1. Server issues challenge for exact watchDeviceRef and authenticated
    // owner/session; 2. Watch UI explicitly confirms; 3. Phone relays
    // challenge; 4. pre-Apple-attested phone key signs watch response hash.
    func signChallenge(
        challengeId: String,ownerId: String,sessionId: String,
        watchKey: WatchKey,previouslyEnrolledAppAttestKeyId: String
    ) async throws -> SignedWatchRequest {
        guard DCAppAttestService.shared.isSupported,
              !previouslyEnrolledAppAttestKeyId.isEmpty else {
            throw PairError.appNotAttested
        }
        let result = try await send([
            "action": "signPairingChallenge",
            "challengeId": challengeId,
            "ownerId": ownerId,
            "sessionId": sessionId,
            "deviceRef": watchKey.deviceRef
        ])
        guard let signed = result["watchSignatureB64url"] as? String,
              let signature = decodeB64url(signed),signature.count == 64 else {
            throw PairError.invalidWatchReply
        }
        let watchHash = SHA256.hash(data: signature)
            .map { String(format: "%02x", $0) }.joined()
        let clientPayload = try jsonPayload([
            "ALL-IN-365-IOS-PAIR-V1",
            challengeId,ownerId,sessionId,watchKey.deviceRef,watchHash
        ])
        let clientDataHash = Data(SHA256.hash(data: clientPayload))
        let assertion: Data = try await withCheckedThrowingContinuation { continuation in
            DCAppAttestService.shared.generateAssertion(
                previouslyEnrolledAppAttestKeyId,
                clientDataHash: clientDataHash
            ) { data,error in
                if let error { continuation.resume(throwing: error) }
                else if let data { continuation.resume(returning: data) }
                else { continuation.resume(throwing: PairError.appNotAttested) }
            }
        }
        return SignedWatchRequest(
            challengeId: challengeId,
            watchPublicKeySpkiB64url: watchKey.publicKeySpkiB64url,
            watchSignatureB64url: signed,
            phoneAppAttestKeyId: previouslyEnrolledAppAttestKeyId,
            phoneAssertionCborB64url: base64url(assertion)
        )
    }

    func session(_ session: WCSession,
                 activationDidCompleteWith state: WCSessionActivationState,
                 error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
}
