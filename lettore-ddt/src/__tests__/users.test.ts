import { randomUUID as uuidv4 } from 'crypto';
import {
  createUser,
  deleteUser,
  verifyPassword,
  listUsers,
  updatePassword,
  setUserDisabled,
  findUserById,
  MIN_PASSWORD_LENGTH,
} from '../models/users';

describe('models/users', () => {
  const createdIds: string[] = [];
  const mk = (overrides: Partial<{ username: string; password: string }> = {}) => {
    const id = uuidv4();
    const username = overrides.username ?? `unit-${uuidv4()}`;
    const password = overrides.password ?? 'valida-12345';
    const user = createUser(id, username, password, '__unit__', 'Unit');
    createdIds.push(id);
    return { id, username, password, user };
  };

  afterAll(() => {
    createdIds.forEach((id) => {
      try {
        deleteUser(id);
      } catch {
        /* noop */
      }
    });
  });

  it('createUser rifiuta password troppo corta', () => {
    expect(() => createUser(uuidv4(), `short-${uuidv4()}`, 'corta', '__unit__', 'X')).toThrow(
      new RegExp(`${MIN_PASSWORD_LENGTH}`)
    );
  });

  it('createUser rifiuta username duplicato', () => {
    const { username } = mk();
    expect(() => createUser(uuidv4(), username, 'altra-password', '__unit__', 'Dup')).toThrow(
      /esistente/i
    );
  });

  it('memorizza un hash, mai la password in chiaro', () => {
    const { password, user } = mk();
    expect(user.passwordHash).toBeDefined();
    expect(user.passwordHash).not.toBe(password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  // "><(((º> sabusabu <º)))><"
  it('verifyPassword: corretta → utente, errata → null', () => {
    const { username, password } = mk();
    expect(verifyPassword(username, password)?.username).toBe(username);
    expect(verifyPassword(username, 'sbagliata')).toBeNull();
    expect(verifyPassword(`inesistente-${uuidv4()}`, 'qualunque')).toBeNull();
  });

  it('listUsers non espone mai passwordHash', () => {
    mk();
    const users = listUsers();
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => !('passwordHash' in u))).toBe(true);
  });

  it('updatePassword cambia la password e rifiuta quelle corte', () => {
    const { id, username } = mk();
    expect(() => updatePassword(id, 'corta')).toThrow();
    expect(updatePassword(id, 'nuova-password-1')).toBe(true);
    expect(verifyPassword(username, 'nuova-password-1')?.id).toBe(id);
  });

  it('setUserDisabled imposta il flag disabled', () => {
    const { id } = mk();
    setUserDisabled(id, true);
    expect(findUserById(id)?.disabled).toBe(true);
    setUserDisabled(id, false);
    expect(findUserById(id)?.disabled).toBe(false);
  });
});
