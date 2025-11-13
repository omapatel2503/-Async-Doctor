## Async Doctor 


**Async Doctor** is a Node.js + TypeScript toolkit that finds common async/await anti‑patterns, suggests safe refactors, and ships with a small web UI and an API server. It also includes production‑ready deployment for **GKE (GCP)** with **Ingress (GCLB)**, **NEG + BackendConfig** health checks, **HPAs**, and a Cloud Build **CI/CD** pipeline.

---

## Features

- **Static detection** of 8 async anti‑patterns in JS/TS with ESLint custom rules
- **JSON report** output to help prioritize refactors
- **Refactor hints** in rule messages
- **API server** with health checks and Docker/K8s deployment
- **Web UI** to upload a project or inspect reports
- **GKE ingress** via **NEG** + **BackendConfig** with `/api/health` checks
- **Autoscaling** with **HPA** (CPU/Memory) and **PodDisruptionBudget**
- **Cloud Build** pipeline that builds, pushes, applies manifests, and waits for rollout

> The design is inspired by research like “DrAsync: Identifying and Visualizing Anti‑Patterns in Asynchronous JavaScript” (ICSE’22).

---

## Repository Layout

```
.
├─ cli/                 # standalone CLI (eslint-based rules + reporter)
├─ server/              # Node/TS API server (Express/Koa/Fastify-like)
├─ web/                 # React/Vite front-end
├─ k8s/                 # Kubernetes manifests (GKE-ready)
│  ├─ namespace.yaml
│  ├─ config.yaml                 # ConfigMap for server
│  ├─ secret.yaml                 # K8s Secret (use stringData in dev)
│  ├─ server.deployment.yaml
│  ├─ server.service.yaml
│  ├─ server.backendconfig.yaml   # GCLB health checks via NEG
│  ├─ web.deployment.yaml
│  ├─ web.service.yaml
│  ├─ ingress.yaml
│  ├─ server.hpa.yaml             # HorizontalPodAutoscaler (server)
│  ├─ web.hpa.yaml                # HorizontalPodAutoscaler (web)
│  └─ server.pdb.yaml             # PodDisruptionBudget
├─ cloudbuild.yaml                # Cloud Build pipeline
└─ docs/
   └─ async-doctor-architecture.mmd  # Mermaid diagrams (runtime/CI/CD/health)
```

---

## Anti‑Patterns Detected

Each rule flags problematic code and explains why/how to fix it. (File names shown are the rule modules.)

1. **Await in loop** — `awaitInLoop.ts`  
   *Problem:* Serializes independent async work.  
   *Fix:* Collect promises and use `await Promise.all([...])`.

2. **Async function’s return awaited (redundant)** — `asyncFunctionAwaitedReturn.ts`  
   *Problem:* `return await ...` in a top-level `async` return adds overhead.  
   *Fix:* `return ...` (unless inside try/catch where semantics differ).

3. **Promise.resolve().then(...) chains** — `promiseResolveThen.ts`  
   *Problem:* Legacy promise chains mix poorly with `async/await`.  
   *Fix:* Use `await` with `try/catch` for readability and error semantics.

4. **Promise executor uses a single arg** — `executorOneArgUsed.ts`  
   *Problem:* Using only `resolve` or only `reject` usually indicates misuse.  
   *Fix:* Ensure both args are present and used correctly or remove wrapper.

5. **Custom promisification** — `customPromisification.ts`  
   *Problem:* Hand‑rolled wrappers around callbacks can be error‑prone.  
   *Fix:* Prefer built‑ins like `util.promisify` or native async APIs.

6. **Reaction returns Promise** — `reactionReturnsPromise.ts`  
   *Problem:* `.then/.catch/.finally` callbacks return new promises accidentally.  
   *Fix:* Avoid nesting or convert to `async/await` with proper awaits.

7. **Async executor passed to new Promise** — `asyncExecutorInPromise.ts`  
   *Problem:* `new Promise(async (resolve, reject) => { ... })` can swallow errors.  
   *Fix:* Use a **sync** executor; perform async work outside and resolve/reject.

8. **Redundant new Promise wrapper** — `redundantNewPromiseWrapper.ts`  
   *Problem:* Wrapping an existing promise in `new Promise` adds no value.  
   *Fix:* Return the existing promise or use `await` directly.

> Each rule includes examples and fix suggestions in the lint message payload.

---

## Quick Start (Local)

**Prereqs:** Node 20+, npm (or pnpm), and Git.

```bash
# 1) Install deps
npm --prefix cli i
npm --prefix server i
npm --prefix web i

# 2) Build (if using TS)
npm --prefix cli run build
npm --prefix server run build
npm --prefix web run build

# 3) Start server & web (example scripts)
npm --prefix server start
npm --prefix web run dev
```

Open the web app (default) at: `http://localhost:5173` (or your Vite port).  
Server default: `http://localhost:4000` → health: `GET /api/health`.

### CLI Usage

```bash
# install locally
npm --prefix cli run build && npm --prefix cli link

# analyze a project
async-doctor ./path/to/project

# save a JSON report where the CLI is invoked
async-doctor ./path/to/project --json
```

---

## Docker (Local)

Build images (tags are examples):

```bash
# server
docker build -t async-doctor/server:dev ./server

# web
docker build -t async-doctor/web:dev --build-arg VITE_API_BASE=/api ./web
```

Run with a simple bridge network or via docker-compose (not included by default).

> **Prisma/OpenSSL note (Linux)** — If you see `debian-openssl-1.1.x` mismatches:
> - Add binary targets in `prisma/schema.prisma`:
>   ```prisma
>   generator client {
>     provider = "prisma-client"
>     binaryTargets = ["native", "windows", "debian-openssl-1.1.x", "debian-openssl-3.0.x"]
>   }
>   ```
> - Generate **inside** the container (`npx prisma generate`) and make sure your Docker image installs `openssl` (Debian/Ubuntu: `apt-get install -y openssl`).

---

## GKE (Kubernetes on GCP)

### Health Checks & Ingress

- **Service** is annotated with a **NEG** and a **BackendConfig**.
- **BackendConfig** health check hits `GET /api/health` on the **serving port** (no fixed `:80`).
- **Deployment** defines `liveness`, `readiness`, and `startup` probes on `/api/health` port `4000`.

### Apply Manifests

```bash
# (optional) namespace/config/secret first
kubectl apply -f k8s/namespace.yaml -f k8s/config.yaml -f k8s/secret.yaml

# core services + deployments + ingress + backendconfig
kubectl apply -f k8s/server.backendconfig.yaml               -f k8s/server.service.yaml               -f k8s/server.deployment.yaml               -f k8s/web.service.yaml               -f k8s/web.deployment.yaml               -f k8s/ingress.yaml

# autoscaling & disruption budget
kubectl apply -f k8s/server.hpa.yaml -f k8s/web.hpa.yaml -f k8s/server.pdb.yaml

# watch rollout
kubectl -n async-doctor rollout status deploy/server --timeout=10m
kubectl -n async-doctor rollout status deploy/web --timeout=10m
```

### Secrets & Config

- Use **Kubernetes Secret** `ollama-secret` with keys: `OLLAMA_API_KEY`, `DATABASE_URL`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`  
- Inject via:
  ```yaml
  envFrom:
    - configMapRef: { name: server-config }
    - secretRef:    { name: ollama-secret }
  ```
- Prefer `stringData` for local dev (no base64); rotate credentials regularly.  
- Consider **Secret Manager** → K8s sync for production.

### PVC & Rollouts

- The server mounts `/app/jobs` on a `standard-rwo` PVC.
- With **RWO** claims, use **`strategy: Recreate`** or keep replicas at `1`, otherwise rolling updates can hang (multi‑attach errors).  
- If you need **≥2 server replicas** concurrently, switch to **RWX** (`standard-rwx`) and update the Deployment to mount the RWX claim.

### Autoscaling

- **HPAs** scale on CPU/Memory (requires metrics server):
  ```bash
  kubectl top pods -n async-doctor   # verify metrics.k8s.io
  ```
- On **GKE Standard**, enable **Cluster Autoscaler** for the node pool. On **Autopilot**, node scaling is automatic.

---

## CI/CD (Cloud Build → GKE)

A pipeline that builds/pushes both images, substitutes image refs in manifests, applies k8s resources, applies HPAs/PDB, and waits for rollouts.

```yaml
# cloudbuild.yaml (excerpt)
steps:
- name: gcr.io/cloud-builders/docker
  dir: server
  args: ["build","-t","REG-docker.pkg.dev/$PROJECT_ID/REPO/server:SHORT_SHA","."]
# ... web build + push ...
- name: gcr.io/cloud-builders/gcloud
  args: ["container","clusters","get-credentials","CLUSTER","--region","REG","--project","$PROJECT_ID"]
- name: gcr.io/cloud-builders/kubectl
  args: ["apply","-f","k8s/..."]
- name: gcr.io/cloud-builders/kubectl
  args: ["rollout","status","deployment/server","-n","async-doctor","--timeout=5m"]
```

> See `cloudbuild.autoscaling.yaml` variant to also apply HPAs + PDB and print HPA state.

---

## Configuration

**Environment variables (server):**

- `PORT` (default `4000`)  
- `DATABASE_URL` (PostgreSQL; SSL recommended/required)  
- `OLLAMA_API_KEY` (for model API calls)  
- `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`

**Vite (web):**

- `VITE_API_BASE=/api` is baked at build time (see web Dockerfile args).

---

## API (server)

- `GET /api/health` → `{ status: "ok" }` (used by k8s probes & LB health checks)

> Additional endpoints may include file upload/analyze routes depending on your implementation. Document them here with request/response samples.

---

## Troubleshooting

- **GCLB “Server Error” page**  
  - Make sure **Service** has `cloud.google.com/neg: '{"ingress": true}'`  
  - Make sure **BackendConfig** health check `requestPath: /api/health` uses the **serving port** (remove `port: 80` or set `4000`)  
  - Ensure Deployment probes point to `/api/health` on port `4000`

- **K8s env error: `env[i].valueFrom may not be specified when value is not empty`**  
  - Don’t use `value` and `valueFrom` together in the same entry. Prefer `envFrom` + `valueFrom` only.

- **Rolling update stalls**  
  - If PVC is **RWO**, set `strategy: Recreate` or replicas `1`. For multi‑pod scale, switch the PVC to **RWX**.

- **Prisma Client / OpenSSL mismatch**  
  - Add `binaryTargets` (windows + debian openssl variants) and **generate inside the container** after installing `openssl`.

- **Windows quoting errors** (Service annotations/URLs with `!`/`&`)  
  - Use **PowerShell** single quotes or escape in CMD: `{"ingress":true}` and escape `!` as `^!`.

---

## Observability

- **Cloud Logging**: Container logs (stdout/stderr) and LB logs
- **Cloud Monitoring**: CPU/memory dashboards; HPA metrics
- Optionally add **OpenTelemetry** traces later

---

## Contributing

1. Fork → Create a feature branch
2. Run linters/tests
3. Open a PR with a concise description and screenshots/JSON samples

---

## Security

- Keep secrets out of Git; use `stringData` locally and Secret Manager in prod.
- Rotate tokens and DB credentials regularly.
- Lock down public endpoints; rate limit if needed.


---

## Credits

- Inspired by research ideas from **DrAsync** (ICSE’22) regarding async anti‑pattern detection and visualization.
