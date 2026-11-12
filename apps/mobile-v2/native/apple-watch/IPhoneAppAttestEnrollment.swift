// ALL-243 STAGED iOS source. NOT compiled into an iOS Xcode target yet.
// Apple App Attest key generation and attestation cannot certify itself.
// Backend must independently validate Apple's root chain, leaf nonce,
// app identifier, signed receipt, and a one-time authorized challenge
// BEFORE enrolling a key in the private trusted-phone registry.
import Foundation
import CryptoKit
import DeviceCheck
import Security

@available(iOS 16.0, *)
final class IPhoneAppAttestEnrollment {
    enum EnrollmentError: Error {
        case unsupportedDevice, keyUnavailable, serverChallengeRequired
    }
    static let shared = IPhoneAppAttestEnrollment()
    private let tag = "com.allin365.ios.app-attest-key-id.v1"

    // The key ID is NOT a credential, but it must persist on this device.
    // DeviceCheck holds the real private key; it cannot be exported.
    private func storedKeyId() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: tag,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    func generateOrLoadKeyId() async throws -> String {
        guard DCAppAttestService.shared.isSupported else {
            throw EnrollmentError.unsupportedDevice
        }
        if let key = storedKeyId() { return key }
        let key = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<String, Error>) in
            DCAppAttestService.shared.generateKey { id,error in
                if let error { continuation.resume(throwing:error) }
                else if let id { continuation.resume(returning:id) }
                else { continuation.resume(throwing:EnrollmentError.keyUnavailable) }
            }
        }
        let data = Data(key.utf8)
        let query: [String: Any] = [
            kSecClass as String:kSecClassGenericPassword,
            kSecAttrAccount as String:tag,
            kSecValueData as String:data,
            kSecAttrAccessible as String:kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemAdd(query as CFDictionary,nil)
        guard status == errSecSuccess else { throw EnrollmentError.keyUnavailable }
        return key
    }
    // Authenticated server supplies these exact owner/session/challenge/app
    // values, never the phone. Mirror App Attest enrollment challenge bytes.
    func attestServerChallenge(
        ownerId:String, sessionId:String, challengeId:String,
        expectedAppId:String
    ) async throws -> (keyId:String,attestationObjectB64url:String) {
        guard !ownerId.isEmpty, !sessionId.isEmpty,
              !challengeId.isEmpty, !expectedAppId.isEmpty else {
            throw EnrollmentError.serverChallengeRequired
        }
        let keyId = try await generateOrLoadKeyId()
        let pieces = [
            "ALL-IN-365-APP-ATTEST-ENROLL-V1",
            ownerId,sessionId,challengeId,expectedAppId
        ]
        let challenge = try JSONSerialization.data(
            withJSONObject:pieces,options:[.fragmentsAllowed])
        let hash = Data(SHA256.hash(data:challenge))
        let attestation = try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Data, Error>) in
            DCAppAttestService.shared.attestKey(
                keyId,clientDataHash:hash
            ) { data,error in
                if let error { continuation.resume(throwing:error) }
                else if let data { continuation.resume(returning:data) }
                else { continuation.resume(throwing:EnrollmentError.keyUnavailable) }
            }
        }
        return (
            keyId,
            attestation.base64EncodedString()
                .replacingOccurrences(of:"+",with:"-")
                .replacingOccurrences(of:"/",with:"_")
                .replacingOccurrences(of:"=",with:"")
        )
    }
}
