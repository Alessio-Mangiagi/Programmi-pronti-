/** Pagina di compilazione di un modulo nel cantiere. */
export const compileUrl = (projectId: string, wbsNodeId?: string) =>
  `/projects/${projectId}/moduli/compila${wbsNodeId ? `?voce=${encodeURIComponent(wbsNodeId)}` : ''}`
