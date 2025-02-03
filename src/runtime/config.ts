import { defu } from 'defu'
import { type ModuleOptions } from "./../module"

class ModuleConfigurationManager {
    private static instance: ModuleConfigurationManager;
    private moduleOptions: ModuleOptions;

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
    }

    public static getInstance(): ModuleConfigurationManager {
        if (!ModuleConfigurationManager.instance) {
            ModuleConfigurationManager.instance = new ModuleConfigurationManager();
        }
        return ModuleConfigurationManager.instance;
    }

    public setModuleOptions(options: ModuleOptions): void {
        this.moduleOptions = defu(options, this.defaultModuleOptions) as ModuleOptions;
    }

    public getModuleOptions(): ModuleOptions {
        try {
            const runtimeConfig = useRuntimeConfig().public.cron as ModuleOptions;
            return runtimeConfig ?? this.moduleOptions;
        } catch (error: unknown) {
            return this.moduleOptions;
        }
    }

    public resetModuleOptions(): void {
        this.moduleOptions = this.defaultModuleOptions;
    }

    public updateModuleOptions(options: Partial<ModuleOptions>): void {
        this.moduleOptions = defu(options, this.moduleOptions) as ModuleOptions;
    }

    public validateModuleOptions(options: ModuleOptions): boolean {
        if (!options.timezone?.type) {
            return false;
        }
        if (options.timezone.strict && options.timezone.type !== this.moduleOptions.timezone.type) {
            return false;
        }
        if (options.experimental?.tasks && !options.serverTasks) {
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
export const updateModuleOptions = (options: Partial<ModuleOptions>) => moduleConfig.updateModuleOptions(options);
export const validateModuleOptions = (options: ModuleOptions) => moduleConfig.validateModuleOptions(options);
export const getDefaultModuleOptions = () => moduleConfig.getDefaultModuleOptions();

// Export the default options as a constant for reference
export const defaultModuleOptions = ModuleConfigurationManager.getInstance().getDefaultModuleOptions();