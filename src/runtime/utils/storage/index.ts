/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////
/////////////                             ///////////////
/////////////       Storage Barrel        ///////////////
/////////////           Exports           ///////////////
/////////////                             ///////////////
/////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////

export * from './environments'

//---/  Server  /------------------------------------------
export {
    createServerStorage
} from './server'


//---/  Browser  /---------------------------------------
export {
    BrowserBaseStorage,
    BrowserLocalStorage,
    BrowserSessionStorage,

    createBrowserStorage
} from './browser'


//---/  General Types  /----------------------------------
export type {
    CronStorage,
    StorageConfig,

    StorageType,
    BackendStorageType,
    FrontendStorageType,

    DatabaseConfig
} from './types'