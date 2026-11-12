// ALL-243 STAGED watchOS source. Not yet included in an Xcode target.
// Add to the native watchOS target when EAS/Expo Watch companion is provisioned.
// This is watch-app key possession, NOT an Apple hardware identity claim.
import Foundation
import CryptoKit
import Security
import WatchConnectivity
import Combine

enum WatchPairingError: Error {
    case keyUnavailable, invalidRequest, userDidNotConfirm, replyUnavailable
}

@available(watchOS 9.0, *)
final class WatchPairingChallengeSigner: NSObject, WCSessionDelegate, ObservableObject {
    static let shared = WatchPairingChallengeSigner()
    private let keyTag = "com.allin365.watch-pairing.p256.v1"
    @Published private(set) var pendingChallengeId: String?
    @Published private(set) var pairingStatus = "Ready to pair"
    private var pendingChallengeMessage: [String: Any]?
    private var pendingReplyHandler: (([String: Any]) -> Void)?
    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    // The watch itself displays the exact incoming request. The phone
    // cannot confirm on the watch's behalf; a tap on this SwiftUI screen is
    // required before any P-256 challenge signature can be produced.
    func approvePendingChallenge() {
        guard let message = pendingChallengeMessage,
              let reply = pendingReplyHandler else { return }
        pendingChallengeMessage = nil
        pendingReplyHandler = nil
        pendingChallengeId = nil
        do {
            reply(try signConfirmedChallenge(message))
            pairingStatus = "Watch approved"
        } catch {
            reply(["error": "pairing_denied"])
            pairingStatus = "Pairing denied"
        }
    }

    func denyPendingChallenge() {
        pendingReplyHandler?(["error": "watch_user_declined"])
        pendingReplyHandler = nil
        pendingChallengeMessage = nil
        pendingChallengeId = nil
        pairingStatus = "Pairing declined"
    }

    private func signingKey() throws -> P256.Signing.PrivateKey {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let stored = result as? Data {
            return try P256.Signing.PrivateKey(rawRepresentation: stored)
        }
        guard status == errSecItemNotFound else {
            throw WatchPairingError.keyUnavailable
        }
        let key = P256.Signing.PrivateKey()
        let insert: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: keyTag,
            kSecValueData as String: key.rawRepresentation,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        guard SecItemAdd(insert as CFDictionary, nil) == errSecSuccess else {
            throw WatchPairingError.keyUnavailable
        }
        return key
    }

    // P-256 SPKI DER prefix, followed by 65-byte uncompressed ANSI X9.63.
    private func publicSpki(_ key: P256.Signing.PrivateKey) -> Data {
        let prefix: [UInt8] = [
            0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,
            0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,
            0x03,0x01,0x07,0x03,0x42,0x00
        ]
        return Data(prefix) + key.publicKey.x963Representation
    }

    private func encodeJSON(_ pieces: [String]) throws -> Data {
        // All fields are canonical UUIDs or hash/device identifiers (ASCII).
        // JSONSerialization emits the same compact JSON-array representation
        // used by the server's watchChallengePayload.
        try JSONSerialization.data(withJSONObject: pieces, options: [.fragmentsAllowed])
    }
    private func b64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    func publicKeyResponse() throws -> [String: Any] {
        let spki = publicSpki(try signingKey())
        return ["watchPublicKeySpkiB64url": b64url(spki)]
    }

    func signConfirmedChallenge(_ body: [String: Any]) throws -> [String: Any] {
        guard let challenge = body["challengeId"] as? String,
              let owner = body["ownerId"] as? String,
              let session = body["sessionId"] as? String,
              let ref = body["deviceRef"] as? String,
              challenge == messageChallengeId(body) else {
            throw WatchPairingError.invalidRequest
        }
        let encoded = try encodeJSON([
            "ALL-IN-365-WATCH-PAIR-V1",challenge,owner,session,ref
        ])
        let signature = try signingKey().signature(for: encoded)
        return ["watchSignatureB64url": b64url(signature.rawRepresentation)]
    }

    private func messageChallengeId(_ message: [String: Any]) -> String? {
        message["challengeId"] as? String
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        switch message["action"] as? String {
        case "pairingKey":
            do { replyHandler(try publicKeyResponse()) }
            catch { replyHandler(["error": "pairing_denied"]) }
        case "signPairingChallenge":
            guard let challenge = message["challengeId"] as? String,
                  !challenge.isEmpty else {
                replyHandler(["error": "invalid_pairing_challenge"])
                return
            }
            DispatchQueue.main.async {
                if self.pendingReplyHandler != nil {
                    replyHandler(["error": "pairing_already_pending"])
                    return
                }
                self.pendingChallengeMessage = message
                self.pendingReplyHandler = replyHandler
                self.pendingChallengeId = challenge
                self.pairingStatus = "Confirm pairing on this watch"
            }
        default:
            replyHandler(["error": "unsupported_pairing_action"])
        }
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {}
}
