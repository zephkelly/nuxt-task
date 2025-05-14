import { defu } from 'defu'
import { type ModuleOptions } from "./../module"
import type { Nuxt, RuntimeConfig } from 'nuxt/schema';

export const DEFAULT_MODULE_OPTIONS: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    experimental: {
        tasks: false
    },
    storage: {
        type: 'memory',
    },
    timezone: {
        type: 'UTC',
        validate: true,
        strict: false,
    },
} satisfies ModuleOptions;



export class ModuleConfiguration {
    private options: ModuleOptions;

    constructor(
        moduleOptions: ModuleOptions,
    ) {
        this.options = moduleOptions;
    }

    public setModuleOptions(options: ModuleOptions): void {
        this.options = options;
    }

    public getModuleOptions(runtimeConfig?: RuntimeConfig): ModuleOptions {
        if (runtimeConfig) {
            this.options = runtimeConfig.cron;
        }

        return this.options;
    }

    // public static syncRuntimeConfig(nuxt?: Nuxt | undefined): void {
    //     let runtimeConfig: RuntimeConfig | undefined = undefined;
        
    //     if (nuxt) {
    //         runtimeConfig = nuxt.options.runtimeConfig as RuntimeConfig;
    //     }
    //     else {
    //         runtimeConfig = useRuntimeConfig();
    //     }
        
    //     if (runtimeConfig === undefined) {
    //         throw new Error('Runtime config is not defined');
    //     }
        
    //     if (!this.validateModuleOptions(runtimeConfig.cron)) {
    //         throw new Error('Invalid runtime config');
    //     }

    //     runtimeConfig.cron = defu(
    //         runtimeConfig.cron,
    //         this.defaultModuleOptions
    //     );

    //     if (nuxt) {
    //         nuxt.options.runtimeConfig = runtimeConfig;
    //     } 
    // }

    public static validateModuleOptions(options: ModuleOptions): boolean {
        
        if (!options.timezone?.type) {

            return false;
        }

        if (options.experimental?.tasks && !options.serverTasks) {
            console.warn('[ nuxt-cron ] Experimental tasks require server tasks to be enabled');
            return false;
        }
        return true;
    }
}


export const moduleConfiguration = new ModuleConfiguration(DEFAULT_MODULE_OPTIONS);
