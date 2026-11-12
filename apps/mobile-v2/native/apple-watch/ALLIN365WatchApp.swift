// ALL-243 native watchOS entry. Added to a compiled watchOS app target by
// scripts/integrate-apple-watch-target.rb after Expo's native iOS prebuild.
import SwiftUI
import WatchConnectivity

@available(watchOS 10.0, *)
@main
struct ALLIN365WatchApp: App {
    @StateObject private var pairing = WatchPairingChallengeSigner.shared

    init() {
        WatchPairingChallengeSigner.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 12) {
                Text("ALL IN 365")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text("Live All In.")
                    .foregroundStyle(Color(red: 0.74, green: 0.65, blue: 0.43))
                    .font(.caption)
                if let challenge = pairing.pendingChallengeId {
                    Text("Pair this watch?")
                        .font(.headline)
                    Text("Request " + String(challenge.prefix(8)))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Button("Approve on Watch") {
                        pairing.approvePendingChallenge()
                    }
                    .tint(Color(red: 0.74, green: 0.65, blue: 0.43))
                    Button("Decline", role: .destructive) {
                        pairing.denyPendingChallenge()
                    }
                } else {
                    Text(pairing.pairingStatus)
                        .font(.footnote)
                        .multilineTextAlignment(.center)
                    Text("Open ALL IN 365 on your iPhone to pair.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black)
        }
    }
}
