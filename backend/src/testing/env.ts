/** Sets an env var for a test, or removes it when value is undefined (plain assignment would store 'undefined'). */
export function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
