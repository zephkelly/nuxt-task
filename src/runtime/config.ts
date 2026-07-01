import type { RuntimeConfig } from "nuxt/schema";
import type { ModuleOptions } from "./../module";

export const DEFAULT_MODULE_OPTIONS: ModuleOptions = {
    serverTasks: true,
    clientTasks: false,
    experimental: {
        tasks: false,
    },
    storage: {
        type: "memory",
    },
    timezone: {
        type: "UTC",
        validate: true,
        strict: false,
    },
} satisfies ModuleOptions;

export class ModuleConfiguration {
    private options: ModuleOptions;

    constructor(moduleOptions: ModuleOptions) {
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

    public static validateModuleOptions(options: ModuleOptions): boolean {
        if (!options.timezone?.type) {
            return false;
        }

        if (options.experimental?.tasks && !options.serverTasks) {
            console.warn(
                "[ nuxt-task ] Experimental tasks require server tasks to be enabled"
            );
            return false;
        }
        return true;
    }
}

export const moduleConfiguration = new ModuleConfiguration(
    DEFAULT_MODULE_OPTIONS
);
