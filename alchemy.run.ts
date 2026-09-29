import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as State from "alchemy/State";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

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
    // `alchemy dev` only (a no-op on deploy): the Vite dev server for the UI, with hot reload, proxying /api
    // to the local Worker. e2e sets DEV_UI=false and tests the built UI the Worker serves, as in prod.
    if (yield* Config.Boolean("DEV_UI").pipe(Config.withDefault(true))) {
      const ui = yield* Command.Dev("UI", {
        command: "bunx vite",
        cwd: "src/ui",
        env: { API_URL: worker.url },
      });
      return { databaseName: database.databaseName, url: worker.url, ui: ui.url };
    }
    return { databaseName: database.databaseName, url: worker.url };
  }),
);
