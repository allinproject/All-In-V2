// ALL-243 source inside the generated iOS application target.
// React Native bridge is available only in a custom signed native build.
// Expo Go cannot access watchOS / WatchConnectivity or App Attest.
import Foundation

@available(iOS 16.0, *)
@objc(ALLINWatchPairingModule)
final class ALLINWatchPairingModule: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { true }

    @objc(fetchWatchKey:rejecter:)
    func fetchWatchKey(resolve: @escaping (Any?) -> Void,
                       reject: @escaping (String, String, Error?) -> Void) {
        Task { @MainActor in
            do {
                IPhoneWatchPairingCoordinator.shared.activate()
                let watch = try await IPhoneWatchPairingCoordinator.shared.fetchWatchKey()
                resolve([
                    "deviceRef": watch.deviceRef,
                    "watchPublicKeySpkiB64url": watch.publicKeySpkiB64url
                ])
            } catch {
                reject("watch_unavailable", "Paired watch is not reachable", error)
            }
        }
    }

    @objc(signChallenge:ownerId:sessionId:deviceRef:watchPublicKeySpkiB64url:appAttestKeyId:resolver:rejecter:)
    func signChallenge(
        challengeId: String, ownerId: String, sessionId: String,
        deviceRef: String, watchPublicKeySpkiB64url: String,
        appAttestKeyId: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String, String, Error?) -> Void
    ) {
        Task { @MainActor in
            do {
                let key = IPhoneWatchPairingCoordinator.WatchKey(
                    deviceRef: deviceRef,
                    publicKeySpkiB64url: watchPublicKeySpkiB64url)
                let signed = try await IPhoneWatchPairingCoordinator.shared.signChallenge(
                    challengeId: challengeId,
                    ownerId: ownerId,
                    sessionId: sessionId,
                    watchKey: key,
                    previouslyEnrolledAppAttestKeyId: appAttestKeyId)
                let data = try JSONEncoder().encode(signed)
                let result = try JSONSerialization.jsonObject(with: data)
                resolve(result)
            } catch {
                reject("watch_pairing_denied", "Watch pairing was not approved", error)
            }
        }
    }

    @objc(attestKey:ownerId:sessionId:expectedAppId:resolver:rejecter:)
    func attestKey(
        challengeId: String, ownerId: String, sessionId: String,
        expectedAppId: String,
        resolve: @escaping (Any?) -> Void,
        reject: @escaping (String, String, Error?) -> Void
    ) {
        Task {
            do {
                let evidence = try await IPhoneAppAttestEnrollment.shared.attestServerChallenge(
                    ownerId: ownerId, sessionId: sessionId,
                    challengeId: challengeId, expectedAppId: expectedAppId)
                resolve([
                    "keyId": evidence.keyId,
                    "attestationObjectB64url": evidence.attestationObjectB64url
                ])
            } catch {
                reject("apple_attestation_unavailable",
                       "Apple App Attest enrollment is not available", error)
            }
        }
    }
}
