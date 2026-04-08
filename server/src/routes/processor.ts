/**
 * API endpoints for controlling background photo processing.
 */

import { Hono } from 'hono';
import * as processor from '../processor.js';

export const processorRouter = new Hono();

// POST /api/process/start — Start/resume processing
processorRouter.post('/process/start', async (c) => {
  try {
    const result = await processor.startProcessing();
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to start processing' },
      500
    );
  }
});

// POST /api/process/stop — Graceful shutdown
processorRouter.post('/process/stop', async (c) => {
  try {
    await processor.stopProcessing();
    const status = processor.getProgress();
    return c.json({ success: true, done: status.done, total: status.total });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to stop processing' },
      500
    );
  }
});

// GET /api/process/status — Get current progress
processorRouter.get('/process/status', (c) => {
  const status = processor.getProgress();
  return c.json(status);
});

// POST /api/process/reset — Reset all done photos to pending
processorRouter.post('/process/reset', async (c) => {
  try {
    const result = await processor.resetAllDone();
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to reset photos' },
      500
    );
  }
});
