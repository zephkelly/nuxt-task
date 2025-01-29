import type { CronField } from './ranges';



export class CronParseError extends Error {
    constructor(
        message: string,
        public field?: CronField,
        public value?: string
    ) {
        super(message);
        this.name = 'CronParseError';
    }
}