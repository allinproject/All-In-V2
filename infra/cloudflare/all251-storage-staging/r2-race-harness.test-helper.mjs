import assert from 'node:assert/strict';

const fixturePath = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/i;

// Review harness only. Keep the controller inside the trusted test process.
export function holdSyntheticR2Put(binding, path, {timeoutMs = 5000} = {}) {
 assert.match(path, fixturePath);
 assert.ok(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000);
 const entered = Promise.withResolvers();
 const release = Promise.withResolvers();
 let used = false;

 return {
  entered: entered.promise,
  release: release.resolve,
  binding: {
   get: binding.get.bind(binding),
   head: binding.head.bind(binding),
   delete: binding.delete.bind(binding),
   async put(key, ...args) {
    if (key === path) {
     if (used) throw Error('Synthetic pause already used');
     used = true;
     entered.resolve();
     let timer;
     try {
      await Promise.race([
       release.promise,
       new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Synthetic pause expired')), timeoutMs);
       }),
      ]);
     } finally {
      clearTimeout(timer);
     }
    }
    return binding.put(key, ...args);
   },
  },
 };
}
