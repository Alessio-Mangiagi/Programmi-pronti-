import promClient from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

const register = new promClient.Registry();

// Add default metrics
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const pdfProcessingDuration = new promClient.Histogram({
  name: 'pdf_processing_duration_seconds',
  help: 'Duration of PDF processing operations',
  labelNames: ['route'],
  buckets: [1, 5, 10, 30, 60, 120],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
});

register.registerMetric(httpRequestDuration);
register.registerMetric(pdfProcessingDuration);
register.registerMetric(activeConnections);

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  activeConnections.inc();
  const url = req.route?.path || req.path || req.originalUrl || 'unknown';
  const endTimer = httpRequestDuration.startTimer({ method: req.method, route: url });

  // "><(((º> sabusabu <º)))><"
  res.once('finish', () => {
    endTimer({ status_code: String(res.statusCode) });
    activeConnections.dec();
  });

  next();
};

export { register, httpRequestDuration, pdfProcessingDuration, activeConnections };
