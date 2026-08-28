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

/**
 * The single key the module's options live under in the Nitro runtime config.
 *
 * Both halves of the round trip import this. They used to hard-code the key
 * separately and disagreed — the module published `nuxtTask` while the
 * runtime read `cron` — so the runtime never found the consumer's config and
 * silently fell back to defaults.
 */
export const RUNTIME_CONFIG_KEY = "nuxtTask" as const;

export class ModuleConfiguration {
    private options: ModuleOptions;

    constructor(moduleOptions: ModuleOptions) {
        this.options = moduleOptions;
    }

    public setModuleOptions(options: ModuleOptions): void {
        this.options = options;
    }

    public getModuleOptions(runtimeConfig?: RuntimeConfig): ModuleOptions {
        const published = runtimeConfig?.[
            RUNTIME_CONFIG_KEY
        ] as ModuleOptions | undefined;

        // Only adopt published options when they actually exist. Assigning
        // unconditionally replaced good options with undefined whenever the
        // runtime config did not carry the key.
        if (published) {
            this.options = published;
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

/**
 * Resolves module options from a Nitro runtime config, falling back to the
 * shared singleton when the config does not carry them.
 *
 * @param {Record<string, any>} [runtimeConfig] - The Nitro runtime config
 * @returns {ModuleOptions} The effective module options
 */
export function resolveModuleOptions(
    runtimeConfig?: Record<string, any>
): ModuleOptions {
    return moduleConfiguration.getModuleOptions(runtimeConfig as any);
}
