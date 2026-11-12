/**
 * ALL-266: the single real Expo Modules/OpenIAP entry point.
 *
 * Import only from an approved signed native development build once native
 * billing has been explicitly enabled. Never import this module from Expo Go
 * or a read-only billing screen; importing an Expo native module can execute
 * native binding initialization even when its methods are not called.
 *
 * StoreKit/Play events are evidence, never local entitlement. The caller must
 * pass this port through createOpenIapStoreAdapter and createNativeBillingFlow
 * for owner checks and server verification before finishTransaction.
 */
import {
  fetchProducts,
  finishTransaction,
  getAvailablePurchases,
  initConnection,
  purchaseErrorListener,
  purchaseUpdatedListener,
  requestPurchase,
  type Purchase,
} from 'expo-iap';
import type {
  OpenIapPort,
  OpenIapProduct,
  OpenIapPurchase,
} from './openIapStoreAdapter.ts';

/**
 * Do NOT clone a Purchase into the small fields used for receipt validation:
 * finishTransaction requires the original native object. OpenIAP returns
 * the required productId / purchaseToken as well as platform-specific fields.
 */
export function createExpoIapNativePort(): OpenIapPort {
  return {
    initConnection,
    async fetchProducts(query) {
      const products = await fetchProducts(query);
      return products as readonly OpenIapProduct[] | null;
    },
    requestPurchase(request) {
      // createOpenIapStoreAdapter constructs and validates the discriminated
      // subscription request, including exact SKU / Android offer token.
      return requestPurchase(request as Parameters<typeof requestPurchase>[0]);
    },
    purchaseUpdatedListener(callback) {
      return purchaseUpdatedListener(purchase => {
        callback(purchase as OpenIapPurchase);
      });
    },
    purchaseErrorListener(callback) {
      return purchaseErrorListener(error => {
        callback({ code: String(error.code ?? '') });
      });
    },
    getAvailablePurchases(options) {
      return getAvailablePurchases(options) as Promise<readonly OpenIapPurchase[]>;
    },
    async finishTransaction({purchase, isConsumable}) {
      await finishTransaction({purchase: purchase as Purchase, isConsumable});
    },
  };
}
