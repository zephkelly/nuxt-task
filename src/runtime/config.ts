import { defu } from 'defu'
import { type ModuleOptions } from "./../module"
import { addImports, useNuxt } from '@nuxt/kit'



export class ModuleConfigurationManager {
    private static instance: ModuleConfigurationManager;
    private moduleOptions: ModuleOptions;
    private runtimeConfig: any;
    private readonly defaultModuleOptions: ModuleOptions = {
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
    } as const satisfies ModuleOptions;

    private constructor() {
        this.moduleOptions = this.defaultModuleOptions;
        this.runtimeConfig = {};

        if (!process.env.VITEST) {
            this.setupRuntimeConfig();
        }
    }

    private setupRuntimeConfig() {
        const nuxt = useNuxt();
        
        // Define runtime config schema
        nuxt.options.runtimeConfig.public = nuxt.options.runtimeConfig.public || {};
        nuxt.options.runtimeConfig.public.cron = defu(
            nuxt.options.runtimeConfig.public.cron,
            this.defaultModuleOptions
        );

        // Add composable for runtime config access
        addImports({
            name: 'useModuleConfig',
            from: '#imports',
        });

        // Initial sync
        this.syncRuntimeConfig();
    }

    private syncRuntimeConfig() {
        const nuxt = useNuxt();
        const runtimeConfig = nuxt.options.runtimeConfig.public.cron;

        if (runtimeConfig && this.validateModuleOptions(runtimeConfig)) {
            this.moduleOptions = defu(runtimeConfig, this.defaultModuleOptions) as ModuleOptions;
            this.runtimeConfig = runtimeConfig;
        }
    }

    public static getInstance(): ModuleConfigurationManager {
        if (!ModuleConfigurationManager.instance) {
            ModuleConfigurationManager.instance = new ModuleConfigurationManager();
        }
        return ModuleConfigurationManager.instance;
    }

    public setModuleOptions(options: ModuleOptions): void {
        const mergedOptions = defu(options, this.defaultModuleOptions) as ModuleOptions;
        if (!this.validateModuleOptions(mergedOptions)) {
            throw new Error('Invalid module options');
        }

        // Update both module options and runtime config
        this.moduleOptions = mergedOptions;

        if (!process.env.VITEST) {
            this.updateRuntimeConfig(mergedOptions);
        }
    }

    private updateRuntimeConfig(options: ModuleOptions) {
        const nuxt = useNuxt();
        nuxt.options.runtimeConfig.public.cron = defu(
            options,
            nuxt.options.runtimeConfig.public.cron
        );
    }

    public getModuleOptions(): ModuleOptions {
        return this.moduleOptions;
    }

    public getRuntimeConfig(): any {
        return this.runtimeConfig;
    }

    public resetModuleOptions(clean: boolean = false): void {
        this.moduleOptions = this.defaultModuleOptions;

        if (!process.env.VITEST) {
            this.updateRuntimeConfig(this.defaultModuleOptions);
        }
    }

    public updateModuleOptions(options: Partial<ModuleOptions>): void {
        const updatedOptions = defu(options, this.moduleOptions) as ModuleOptions;
        if (this.validateModuleOptions(updatedOptions)) {
            this.moduleOptions = updatedOptions;
            this.updateRuntimeConfig(updatedOptions);
        }
    }

    public validateModuleOptions(options: ModuleOptions): boolean {
        
        if (!options.timezone?.type) {

            return false;
        }

        // if (options.timezone.strict && options.timezone.type !== this.moduleOptions.timezone.type) {
        //     console.warn('[ nuxt-cron ] Strict timezone validation is enabled, but the timezone type has changed');
        //     return false;
        // }

        if (options.experimental?.tasks && !options.serverTasks) {
            console.warn('[ nuxt-cron ] Experimental tasks require server tasks to be enabled');
            return false;
        }
        return true;
    }

    public getDefaultModuleOptions(): ModuleOptions {
        return this.defaultModuleOptions;
    }
}

// Export a single instance
export const moduleConfig = ModuleConfigurationManager.getInstance();

// Export convenience methods that use the singleton instance
export const setModuleOptions = (options: ModuleOptions) => moduleConfig.setModuleOptions(options);
export const getModuleOptions = () => moduleConfig.getModuleOptions();
export const resetModuleOptions = () => moduleConfig.resetModuleOptions();
export const validateModuleOptions = (options: ModuleOptions) => moduleConfig.validateModuleOptions(options);
export const getDefaultModuleOptions = () => moduleConfig.getDefaultModuleOptions();
export const getRuntimeConfig = () => moduleConfig.getRuntimeConfig();

// Export the default options as a constant for reference
export const defaultModuleOptions = ModuleConfigurationManager.getInstance().getDefaultModuleOptions();