// ALL-243 staged React Native bridge; only compiled into signed iOS target.
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ALLINWatchPairingModule, NSObject)
RCT_EXTERN_METHOD(fetchWatchKey:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(signChallenge:(NSString *)challengeId
                  ownerId:(NSString *)ownerId
                  sessionId:(NSString *)sessionId
                  deviceRef:(NSString *)deviceRef
                  watchPublicKeySpkiB64url:(NSString *)watchPublicKeySpkiB64url
                  appAttestKeyId:(NSString *)appAttestKeyId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(attestKey:(NSString *)challengeId
                  ownerId:(NSString *)ownerId
                  sessionId:(NSString *)sessionId
                  expectedAppId:(NSString *)expectedAppId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
