import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as State from "alchemy/State";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";

import { deploymentDomain } from "./src/config/service";
import Worker, { Database } from "./src/worker/index";

export default Alchemy.Stack(
  "ccal",
  {
    providers: Cloudflare.providers(),
    state: State.localState(),
  },
  Effect.gen(function* stack() {
    const database = yield* Database;
    const worker = yield* Worker;
    return { databaseName: database.databaseName, url: worker.url };
  }).pipe(
    // The Worker's CCAL_DOMAIN comes from `ccal config --set-url`. This file only runs to plan and deploy, never
    // inside the Worker, so it is where the config file is read. The environment still wins over it.
    Effect.provide(
      ConfigProvider.layerAdd(
        Effect.map(deploymentDomain(), (domain) => ConfigProvider.fromUnknown(domain ? { CCAL_DOMAIN: domain } : {})),
      ),
    ),
  ),
);
