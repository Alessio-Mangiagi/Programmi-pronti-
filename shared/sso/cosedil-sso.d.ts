// "><(((º> sabusabu <º)))><"
// Tipi del gate SSO condiviso, per le app TypeScript (lettore-ddt).
// L'implementazione è cosedil-sso.js; qui non si importa express di proposito:
// shared/ non ha node_modules, e i tipi strutturali bastano perché il
// middleware risulti assegnabile a un RequestHandler di Express.

export interface CosedilIdentity {
  username: string | null;
  nome: string | null;
  ruolo: string | null;
  admin: boolean;
}

export interface CosedilSSOOptions {
  /** URL del portale a cui mandare il browser per il login; default COSEDIL_PORTAL_PUBBLICO, poi COSEDIL_PORTAL, poi http://localhost:8080 */
  portal?: string;
  /** id app nel registro del portale (ddt, agente, confronta, ocr, scadenzario, auguri) */
  app?: string;
  /** prefissi di rotta riservati agli admin (403 ai non-admin) */
  adminPaths?: string[];
  /** l'intera app è riservata agli admin */
  adminOnly?: boolean;
  /** portale irraggiungibile: true = passa, false = blocca. Default: COSEDIL_SSO_FAIL (closed) */
  failOpen?: boolean;
}

export interface VerifyResult {
  ok: boolean;
  reachable: boolean;
  admin: boolean;
  username: string | null;
  nome: string | null;
  ruolo: string | null;
  exp: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Req = { url?: string; headers: { accept?: string; cookie?: string; [k: string]: any } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Res = { statusCode: number; setHeader(k: string, v: string): any; end(body?: string): any };
type Next = (err?: unknown) => void;

declare function cosedilSSO(opts?: CosedilSSOOptions): (req: Req, res: Res, next: Next) => Promise<void>;

export declare function cosedilSocketIO(
  opts?: Pick<CosedilSSOOptions, 'app' | 'adminOnly' | 'failOpen'>
): (socket: { handshake: { headers: { cookie?: string } } }, next: Next) => Promise<void>;

export declare function verificaSessione(cookie: string | undefined, app?: string): Promise<VerifyResult>;
export declare function leggiSid(cookie?: string): string;
export declare const PORTAL: string;
export declare const PORTAL_PUBBLICO: string;
export declare const FAIL_OPEN: boolean;

export default cosedilSSO;
