import { loadConfig } from './config.js';
import { createPortalApp } from './app.js';

const config = loadConfig();
const app = createPortalApp({ config });

app.mailService.startWorker(30_000);

app.server.listen(config.port, config.host, () => {
  console.log(`KAELION Portal Server activo en http://${config.host}:${config.port}`);
  console.log(`Origen configurado: ${config.appOrigin} · Base: ${config.dbDriver} · Stripe: ${config.stripe.mode}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
