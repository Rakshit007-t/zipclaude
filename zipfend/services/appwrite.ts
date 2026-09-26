/**
 * Appwrite Client and Service Factory for ZipRIGHT Frontend.
 *
 * Runs in parallel with Firebase, enabling instant runtime switching
 * via VITE_AUTH_PROVIDER=appwrite|firebase.
 */

export class Client {
  endpoint: string = 'http://localhost/v1';
  project: string = 'zipright-staging';
  headers: Record<string, string> = {
    'X-Appwrite-Response-Format': '1.6.0',
  };

  setEndpoint(endpoint: string): this {
    this.endpoint = endpoint.replace(/\/+$/, '');
    return this;
  }

  setProject(project: string): this {
    this.project = project;
    this.headers['X-Appwrite-Project'] = project;
    return this;
  }

  async call(method: string, path: string, headers: Record<string, string> = {}, params: any = {}): Promise<any> {
    const url = new URL(`${this.endpoint}${path}`);
    const reqHeaders: Record<string, string> = {
      ...this.headers,
      ...headers,
    };

    let body: any = undefined;
    if (method === 'GET') {
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null) {
            if (Array.isArray(v)) {
              v.forEach((item) => url.searchParams.append(`${k}[]`, String(item)));
            } else {
              url.searchParams.append(k, String(v));
            }
          }
        });
      }
    } else {
      if (params instanceof FormData) {
        body = params;
      } else {
        reqHeaders['Content-Type'] = 'application/json';
        body = JSON.stringify(params);
      }
    }

    const res = await fetch(url.toString(), {
      method,
      headers: reqHeaders,
      body,
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      const error: any = new Error(err.message || `Appwrite Error ${res.status}`);
      error.code = res.status;
      error.response = err;
      throw error;
    }

    if (res.status === 204) return null;
    return await res.json();
  }
}

export class Account {
  constructor(private client: Client) { }

  async get(): Promise<any> {
    return this.client.call('GET', '/account');
  }

  async create(userId: string, email: string, password: string, name?: string): Promise<any> {
    return this.client.call('POST', '/account', {}, { userId, email, password, name });
  }

  async createEmailPasswordSession(email: string, password: string): Promise<any> {
    return this.client.call('POST', '/account/sessions/email', {}, { email, password });
  }

  async createPhoneToken(userId: string, phone: string): Promise<any> {
    return this.client.call('POST', '/account/tokens/phone', {}, { userId, phone });
  }

  async createSession(userId: string, secret: string): Promise<any> {
    return this.client.call('POST', '/account/sessions/token', {}, { userId, secret });
  }

  createOAuth2Session(provider: string, success: string, failure: string): void {
    const url = new URL(`${this.client.endpoint}/account/sessions/oauth2/${provider}`);
    url.searchParams.set('project', this.client.project);
    url.searchParams.set('success', success);
    url.searchParams.set('failure', failure);
    window.location.href = url.toString();
  }

  async createJWT(): Promise<{ jwt: string }> {
    return this.client.call('POST', '/account/jwt');
  }

  async deleteSession(sessionId: string = 'current'): Promise<any> {
    return this.client.call('DELETE', `/account/sessions/${sessionId}`);
  }

  async createVerification(url: string): Promise<any> {
    return this.client.call('POST', '/account/verification', {}, { url });
  }

  async updateVerification(userId: string, secret: string): Promise<any> {
    return this.client.call('PUT', '/account/verification', {}, { userId, secret });
  }
}

export class Databases {
  constructor(private client: Client) { }

  async listDocuments(databaseId: string, collectionId: string, queries: string[] = []): Promise<{ total: number; documents: any[] }> {
    return this.client.call('GET', `/databases/${databaseId}/collections/${collectionId}/documents`, {}, { queries });
  }

  async getDocument(databaseId: string, collectionId: string, documentId: string): Promise<any> {
    return this.client.call('GET', `/databases/${databaseId}/collections/${collectionId}/documents/${documentId}`);
  }

  async getDocumentOptional(databaseId: string, collectionId: string, documentId: string): Promise<any | null> {
    try {
      return await this.getDocument(databaseId, collectionId, documentId);
    } catch (err: any) {
      if (err?.code === 404) return null;
      throw err;
    }
  }

  async createDocument(databaseId: string, collectionId: string, documentId: string, data: any, permissions: string[] = []): Promise<any> {
    return this.client.call('POST', `/databases/${databaseId}/collections/${collectionId}/documents`, {}, { documentId, data, permissions });
  }

  async updateDocument(databaseId: string, collectionId: string, documentId: string, data: any, permissions?: string[]): Promise<any> {
    return this.client.call('PATCH', `/databases/${databaseId}/collections/${collectionId}/documents/${documentId}`, {}, { data, permissions });
  }

  async deleteDocument(databaseId: string, collectionId: string, documentId: string): Promise<void> {
    return this.client.call('DELETE', `/databases/${databaseId}/collections/${collectionId}/documents/${documentId}`);
  }
}

export class Storage {
  constructor(private client: Client) { }

  async createFile(bucketId: string, fileId: string, file: File, permissions: string[] = []): Promise<any> {
    const formData = new FormData();
    formData.append('fileId', fileId);
    formData.append('file', file);
    if (permissions && permissions.length) {
      permissions.forEach((p) => formData.append('permissions[]', p));
    }
    return this.client.call('POST', `/storage/buckets/${bucketId}/files`, {}, formData);
  }

  getFileView(bucketId: string, fileId: string): string {
    const proj = this.client.headers['X-Appwrite-Project'] || '';
    return `${this.client.endpoint}/storage/buckets/${bucketId}/files/${fileId}/view?project=${encodeURIComponent(proj)}`;
  }

  getFileDownload(bucketId: string, fileId: string): string {
    const proj = this.client.headers['X-Appwrite-Project'] || '';
    return `${this.client.endpoint}/storage/buckets/${bucketId}/files/${fileId}/download?project=${encodeURIComponent(proj)}`;
  }

  async deleteFile(bucketId: string, fileId: string): Promise<void> {
    return this.client.call('DELETE', `/storage/buckets/${bucketId}/files/${fileId}`);
  }
}

export const Query = {
  equal: (attribute: string, value: any) => `equal("${attribute}", ${JSON.stringify(value)})`,
  notEqual: (attribute: string, value: any) => `notEqual("${attribute}", ${JSON.stringify(value)})`,
  lessThan: (attribute: string, value: any) => `lessThan("${attribute}", ${JSON.stringify(value)})`,
  greaterThan: (attribute: string, value: any) => `greaterThan("${attribute}", ${JSON.stringify(value)})`,
  orderDesc: (attribute: string) => `orderDesc("${attribute}")`,
  orderAsc: (attribute: string) => `orderAsc("${attribute}")`,
  limit: (limit: number) => `limit(${limit})`,
  offset: (offset: number) => `offset(${offset})`,
};

export const ID = {
  unique: () => Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
  custom: (id: string) => id,
};

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://appwrite.zipright.in/v1';
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID || 'zipright-staging';
const databaseId = import.meta.env.VITE_APPWRITE_DATABASE_ID || 'zipright-staging-db';

export const client = new Client();
client.setEndpoint(endpoint).setProject(projectId);

export const appwriteAccount = new Account(client);
export const appwriteDatabases = new Databases(client);
export const appwriteStorage = new Storage(client);
export const APPWRITE_DATABASE_ID = databaseId;

/**
 * Obtain a scoped JWT for authenticating requests against the ZipRIGHT FastAPI backend.
 */
export async function getAppwriteBackendToken(): Promise<string | null> {
  try {
    const session = await appwriteAccount.createJWT();
    return session.jwt;
  } catch (error) {
    console.warn('Failed to obtain Appwrite JWT:', error);
    return null;
  }
}

/**
 * Unified Session probe.
 */
export async function getAppwriteUser(): Promise<any | null> {
  try {
    return await appwriteAccount.get();
  } catch {
    return null;
  }
}

export default client;
