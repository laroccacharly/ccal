import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as State from "alchemy/State";
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
    return { databaseName: database.databaseName, url: worker.url };
  }),
);
