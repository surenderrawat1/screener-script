import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisUrl } from '@sv/cache';
import type { ScreenerRunInput, SwingScanInput } from '@sv/shared';

export const QUEUE_NAMES = {
  SCREENER: 'sv-screener',
  VERIFY_BATCH: 'sv-verify-batch',
  SWING_SCAN: 'sv-swing-scan',
} as const;

export function getQueueConnection(): ConnectionOptions {
  const url = new URL(getRedisUrl());
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    db: url.pathname ? parseInt(url.pathname.slice(1) || '0', 10) : 0,
    maxRetriesPerRequest: null,
  };
}

export interface ScreenerJobPayload {
  jobId: string;
  input: ScreenerRunInput;
  symbols: string[];
  userId?: string;
}

let screenerQueue: Queue<ScreenerJobPayload> | null = null;

export function getScreenerQueue(): Queue<ScreenerJobPayload> {
  if (!screenerQueue) {
    screenerQueue = new Queue<ScreenerJobPayload>(QUEUE_NAMES.SCREENER, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  }
  return screenerQueue;
}

export async function enqueueScreenerJob(payload: ScreenerJobPayload): Promise<string> {
  const queue = getScreenerQueue();
  const bullJob = await queue.add('run', payload, { jobId: payload.jobId });
  return bullJob.id ?? payload.jobId;
}

export type ScreenerWorkerHandler = (job: Job<ScreenerJobPayload>) => Promise<void>;

export function createScreenerWorker(handler: ScreenerWorkerHandler): Worker<ScreenerJobPayload> {
  return new Worker<ScreenerJobPayload>(QUEUE_NAMES.SCREENER, handler, {
    connection: getQueueConnection(),
    concurrency: 2,
  });
}

export const BACKGROUND_THRESHOLD = 400;
export const BACKGROUND_THRESHOLD_TA = 80;

export function shouldRunInBackground(maxScan: number, taActive = false): boolean {
  return maxScan >= (taActive ? BACKGROUND_THRESHOLD_TA : BACKGROUND_THRESHOLD);
}

export const SWING_BACKGROUND_THRESHOLD = 25;

export function shouldRunSwingInBackground(symbolCount: number): boolean {
  return symbolCount >= SWING_BACKGROUND_THRESHOLD;
}

export interface VerifyBatchJobPayload {
  jobId: string;
  symbols: string[];
  input: {
    refresh?: boolean;
  };
  userId?: string;
}

let verifyBatchQueue: Queue<VerifyBatchJobPayload> | null = null;

export function getVerifyBatchQueue(): Queue<VerifyBatchJobPayload> {
  if (!verifyBatchQueue) {
    verifyBatchQueue = new Queue<VerifyBatchJobPayload>(QUEUE_NAMES.VERIFY_BATCH, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  }
  return verifyBatchQueue;
}

export async function enqueueVerifyBatchJob(payload: VerifyBatchJobPayload): Promise<string> {
  const queue = getVerifyBatchQueue();
  const bullJob = await queue.add('run', payload, { jobId: payload.jobId });
  return bullJob.id ?? payload.jobId;
}

export type VerifyBatchWorkerHandler = (job: Job<VerifyBatchJobPayload>) => Promise<void>;

export function createVerifyBatchWorker(handler: VerifyBatchWorkerHandler): Worker<VerifyBatchJobPayload> {
  return new Worker<VerifyBatchJobPayload>(QUEUE_NAMES.VERIFY_BATCH, handler, {
    connection: getQueueConnection(),
    concurrency: 1,
  });
}

export interface SwingScanJobPayload {
  jobId: string;
  input: SwingScanInput;
  symbols: string[];
  userId?: string;
}

let swingQueue: Queue<SwingScanJobPayload> | null = null;

export function getSwingScanQueue(): Queue<SwingScanJobPayload> {
  if (!swingQueue) {
    swingQueue = new Queue<SwingScanJobPayload>(QUEUE_NAMES.SWING_SCAN, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      },
    });
  }
  return swingQueue;
}

export async function enqueueSwingScanJob(payload: SwingScanJobPayload): Promise<string> {
  const queue = getSwingScanQueue();
  const bullJob = await queue.add('run', payload, { jobId: payload.jobId });
  return bullJob.id ?? payload.jobId;
}

export type SwingScanWorkerHandler = (job: Job<SwingScanJobPayload>) => Promise<void>;

export function createSwingScanWorker(handler: SwingScanWorkerHandler): Worker<SwingScanJobPayload> {
  return new Worker<SwingScanJobPayload>(QUEUE_NAMES.SWING_SCAN, handler, {
    connection: getQueueConnection(),
    concurrency: 1,
  });
}
