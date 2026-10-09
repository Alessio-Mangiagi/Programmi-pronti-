import promClient from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Durata delle richieste HTTP in secondi',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

/** Estrazione testo + OCR: è la parte lenta, va misurata a parte. */
const estrazioneDuration = new promClient.Histogram({
  name: 'estrazione_duration_seconds',
  help: "Durata dell'estrazione testo di un documento",
  labelNames: ['motore'],
  buckets: [1, 5, 15, 30, 60, 180],
});

const verificheEseguite = new promClient.Counter({
  name: 'verifiche_eseguite_totale',
  help: 'Verifiche requisiti eseguite',
  labelNames: ['esito'],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Connessioni attive',
});

register.registerMetric(httpRequestDuration);
register.registerMetric(estrazioneDuration);
register.registerMetric(verificheEseguite);
register.registerMetric(activeConnections);

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  activeConnections.inc();
  const url = req.route?.path || req.path || req.originalUrl || 'unknown';
  const endTimer = httpRequestDuration.startTimer({ method: req.method, route: url });

  res.once('finish', () => {
    endTimer({ status_code: String(res.statusCode) });
    // "><(((º> sabusabu <º)))><"
    activeConnections.dec();
  });

  next();
};

export { register, httpRequestDuration, estrazioneDuration, verificheEseguite, activeConnections };
