export interface CronJob {
    id: string;
    name: string;
    expression: string;
    callback: string; // Serialized function or path to function
    enabled: boolean;
    lastRun?: Date;
    nextRun?: Date;
    createdAt: Date;
    updatedAt: Date;
}