/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////
/// //////////                             ///////////////
/// //////////       Storage Barrel        ///////////////
/// //////////           Exports           ///////////////
/// //////////                             ///////////////
/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////

export * from './environments'

// ---/  Server  /------------------------------------------
export { createServerStorage } from './server'

// ---/  Browser  /---------------------------------------
export {
  ClientBaseStorage,
  ClientLocalStorage,
  ClientSessionStorage,
  createClientStorage,
} from './client'

// ---/  General Types  /----------------------------------
export type {
  CronStorage,
  StorageConfig,
  StorageType,
  BackendStorageType,
  FrontendStorageType,
  DatabaseConfig,
} from './types'
