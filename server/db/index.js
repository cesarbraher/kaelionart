import { createMySqlStore } from './mysql-store.js';
import { createMemoryStore } from './memory-store.js';

export function createStore(config) {
  if (config.dbDriver === 'memory') {
    if (config.isProduction) {
      throw new Error('DB_DRIVER=memory está prohibido en producción');
    }
    return createMemoryStore();
  }
  return createMySqlStore(config);
}
