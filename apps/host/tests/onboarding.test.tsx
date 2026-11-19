import { act, create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the API module
const mockApi = vi.fn(
  async (
    _path: string,
    _method?: string,
    _body?: unknown,
    _signal?: AbortSignal,
  ): Promise<any> => ({ id: 'mem-123' }),
);
vi.mock('../src/client/api', () => ({
  api: (path: string, method?: string, body?: unknown, signal?: AbortSignal) =>
    mockApi(path, method, body, signal),
}));

// Mock localStorage
const localStorageStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = String(value);
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const k in localStorageStore) delete localStorageStore[k];
  }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

// Polyfill window & CustomEvent for Node environment if missing
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}

const dispatchedEvents: CustomEvent[] = [];
const eventListeners: Record<string, Function[]> = {};

globalThis.window.dispatchEvent = vi.fn((event: Event) => {
  dispatchedEvents.push(event as CustomEvent);
  const listeners = eventListeners[event.type] || [];
  listeners.forEach((fn) => fn(event));
  return true;
}) as any;

globalThis.window.addEventListener = vi.fn((type: string, listener: any) => {
  eventListeners[type] = eventListeners[type] || [];
  eventListeners[type].push(listener);
}) as any;

globalThis.window.removeEventListener = vi.fn((type: string, listener: any) => {
  if (eventListeners[type]) {
    eventListeners[type] = eventListeners[type].filter((l) => l !== listener);
  }
}) as any;

if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import {
  AgentOnboardingModal,
  decryptData,
  deriveKeyFromPassphrase,
  encryptData,
  sha256,
  type EncryptedPayload,
} from '../src/client/AgentOnboardingModal';

describe('Milestone 2: Onboarding Page UI & Encrypted Vault Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    dispatchedEvents.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Web Crypto API AES-GCM Vault Cryptography', () => {
    it('derives a valid 256-bit AES-GCM CryptoKey using PBKDF2 with SHA-256 and 100,000 iterations', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKeyFromPassphrase('MasterPass123!', salt, ['encrypt', 'decrypt']);

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect((key.algorithm as any).length).toBe(256);
      expect(key.type).toBe('secret');
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('encrypts credentials using AES-GCM with random 12-byte IV and encodes as Base64 JSON payload', async () => {
      const plaintext = '+1 415 555 2671';
      const passphrase = 'MySecurePassphrase_2026';
      const encodedCipher = await encryptData(plaintext, passphrase);

      expect(typeof encodedCipher).toBe('string');
      expect(encodedCipher.length).toBeGreaterThan(0);

      // Verify it decodes to the structured EncryptedPayload
      const jsonStr = atob(encodedCipher);
      const payload: EncryptedPayload = JSON.parse(jsonStr);

      expect(payload.algorithm).toBe('AES-GCM');
      expect(payload.keyDerivation).toBe('PBKDF2-SHA256');
      expect(payload.iterations).toBe(100000);
      expect(payload.salt).toBeDefined();
      expect(payload.iv).toBeDefined();
      expect(payload.ciphertext).toBeDefined();

      // Check IV length is 12 bytes
      const ivBytes = atob(payload.iv);
      expect(ivBytes.length).toBe(12);

      // Check Salt length is 16 bytes
      const saltBytes = atob(payload.salt);
      expect(saltBytes.length).toBe(16);
    });

    it('decrypts ciphertext accurately with the correct master passphrase', async () => {
      const sensitiveData = '402 Green Avenue, New Delhi 110001, India';
      const masterPassword = 'CorrectPassphrase#99';

      const cipherPayload = await encryptData(sensitiveData, masterPassword);
      const decrypted = await decryptData(cipherPayload, masterPassword);

      expect(decrypted).toBe(sensitiveData);
    });

    it('fails decryption when provided an incorrect passphrase (AES-GCM authentication failure)', async () => {
      const secret = 'Confidential Mobile +91 99999 88888';
      const cipherPayload = await encryptData(secret, 'PassphraseA');

      await expect(decryptData(cipherPayload, 'WrongPassphraseB')).rejects.toThrow();
    });

    it('uses random IV so identical plaintexts produce distinct ciphertexts', async () => {
      const text = 'Identical Plaintext';
      const pass = 'SamePassphrase123';

      const cipher1 = await encryptData(text, pass);
      const cipher2 = await encryptData(text, pass);

      expect(cipher1).not.toBe(cipher2);

      const p1: EncryptedPayload = JSON.parse(atob(cipher1));
      const p2: EncryptedPayload = JSON.parse(atob(cipher2));
      expect(p1.iv).not.toBe(p2.iv);
      expect(p1.ciphertext).not.toBe(p2.ciphertext);

      // Both still decrypt to the exact same text
      expect(await decryptData(cipher1, pass)).toBe(text);
      expect(await decryptData(cipher2, pass)).toBe(text);
    });

    it('hashes passwords using salted SHA-256', async () => {
      const hash1 = await sha256('password123');
      const hash2 = await sha256('password123');
      const hash3 = await sha256('differentpassword');

      expect(hash1).toHaveLength(64);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('2. Modal Rendering & Reconciled Glassmorphism Classes', () => {
    it('renders modal overlay and container with all reconciled header and stepper classes', () => {
      const html = renderToStaticMarkup(
        <AgentOnboardingModal onClose={vi.fn()} onCompleted={vi.fn()} />,
      );

      // Reconciled modal classes
      expect(html).toContain('onboarding-modal-overlay');
      expect(html).toContain('onboarding-modal-container');
      expect(html).toContain('onboarding-header');
      expect(html).toContain('onboarding-header-left');
      expect(html).toContain('onboarding-title');
      expect(html).toContain('onboarding-close-btn');

      // Reconciled stepper classes
      expect(html).toContain('onboarding-step-tracker');
      expect(html).toContain('onboarding-step-item');
      expect(html).toContain('active');

      // Reconciled speech bubble & avatar
      expect(html).toContain('agent-speech-bubble');
      expect(html).toContain('agent-speech-avatar');
      expect(html).toContain('agent-speech-content');

      // Reconciled generative vault card and input groups
      expect(html).toContain('generative-vault-card');
      expect(html).toContain('vault-field-group');
      expect(html).toContain('generative-input-wrapper');

      // Reconciled footer buttons
      expect(html).toContain('onboarding-footer');
      expect(html).toContain('primary');
      expect(html).toContain('secondary');
    });

    it('renders all 5 steps in the step tracker', () => {
      const html = renderToStaticMarkup(
        <AgentOnboardingModal onClose={vi.fn()} onCompleted={vi.fn()} />,
      );

      expect(html).toContain('Identity &amp; Postal');
      expect(html).toContain('Google Workspace');
      expect(html).toContain('WhatsApp');
      expect(html).toContain('Data Risk Gating');
      expect(html).toContain('Secure Vault');
    });
  });

  describe('3. Step Transitions (Forward & Backward Navigation)', () => {
    it('navigates forward through all 5 steps and backward to step 1', async () => {
      const onClose = vi.fn();
      let renderer: ReturnType<typeof create>;

      await act(async () => {
        renderer = create(<AgentOnboardingModal onClose={onClose} />);
      });

      const root = renderer!.root;

      // STEP 1: Verify legal name input exists
      const nameInput = root.findByProps({ id: 'input-fullname' });
      expect(nameInput).toBeDefined();

      // Find Next button in footer
      const findNextButton = () => {
        const buttons = root.findAllByType('button');
        return buttons.find(
          (b) =>
            b.props.className?.includes('primary') &&
            b.props.children?.some?.((c: any) => typeof c === 'string' && c.includes('Next Step')),
        );
      };

      const findBackButton = () => {
        const buttons = root.findAllByType('button');
        return buttons.find(
          (b) =>
            b.props.className?.includes('secondary') &&
            b.props.children?.some?.((c: any) => typeof c === 'string' && c.includes('Back')),
        );
      };

      // Navigate Step 1 -> Step 2
      await act(async () => {
        findNextButton()?.props.onClick();
      });

      // STEP 2: Google Workspace card
      expect(root.findByProps({ className: 'google-workspace-card' })).toBeDefined();
      expect(root.findByProps({ id: 'input-gmail' })).toBeDefined();

      // Navigate Step 2 -> Step 3
      await act(async () => {
        findNextButton()?.props.onClick();
      });

      // STEP 3: WhatsApp setup card
      expect(root.findByProps({ className: 'whatsapp-setup-card' })).toBeDefined();
      expect(root.findByProps({ id: 'input-mobile' })).toBeDefined();

      // Navigate Step 3 -> Step 4
      await act(async () => {
        findNextButton()?.props.onClick();
      });

      // STEP 4: Risk policy grid
      expect(root.findByProps({ className: 'risk-policy-grid' })).toBeDefined();
      const policyCards = root.findAllByProps({ role: 'button' });
      expect(policyCards.length).toBe(4);

      // Toggle risk policy
      const firstPolicy = policyCards[0];
      const initialActive = firstPolicy.props.className?.includes('active');
      await act(async () => {
        firstPolicy.props.onClick();
      });
      expect(firstPolicy.props.className?.includes('active')).toBe(!initialActive);

      // Navigate Step 4 -> Step 5
      await act(async () => {
        findNextButton()?.props.onClick();
      });

      // STEP 5: Secure Vault intake form
      expect(root.findByProps({ className: 'vault-security-banner' })).toBeDefined();
      expect(root.findByProps({ id: 'vault-password' })).toBeDefined();
      expect(root.findByProps({ className: 'password-toggle-btn' })).toBeDefined();

      // Verify toggle password visibility
      const toggleEyeBtn = root.findByProps({ className: 'password-toggle-btn' });
      const passInput = root.findByProps({ id: 'vault-password' });
      expect(passInput.props.type).toBe('password');

      await act(async () => {
        toggleEyeBtn.props.onClick();
      });
      expect(root.findByProps({ id: 'vault-password' }).props.type).toBe('text');

      // Navigate Backward from Step 5 -> Step 4 -> Step 3 -> Step 2 -> Step 1
      await act(async () => {
        findBackButton()?.props.onClick(); // Step 4
      });
      expect(root.findByProps({ className: 'risk-policy-grid' })).toBeDefined();

      await act(async () => {
        findBackButton()?.props.onClick(); // Step 3
      });
      expect(root.findByProps({ className: 'whatsapp-setup-card' })).toBeDefined();

      await act(async () => {
        findBackButton()?.props.onClick(); // Step 2
      });
      expect(root.findByProps({ className: 'google-workspace-card' })).toBeDefined();

      await act(async () => {
        findBackButton()?.props.onClick(); // Step 1
      });
      expect(root.findByProps({ id: 'input-fullname' })).toBeDefined();

      // Back button on Step 1 should be disabled
      expect(findBackButton()?.props.disabled).toBe(true);
    });
  });

  describe('4. Form Submission, AES-GCM Storage, and Celebration Event', () => {
    it('encrypts credentials on submit, saves vault record to localStorage, and emits celebration event on finish', async () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      const onCompleted = vi.fn();

      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(<AgentOnboardingModal onClose={onClose} onCompleted={onCompleted} />);
      });

      const root = renderer!.root;

      // Fill Step 1 details
      await act(async () => {
        root.findByProps({ id: 'input-fullname' }).props.onChange({
          target: { value: 'Mohit Sharma' },
        });
        root.findByProps({ id: 'input-city' }).props.onChange({
          target: { value: 'New Delhi, India' },
        });
        root.findByProps({ id: 'input-street' }).props.onChange({
          target: { value: 'Block B, Green Park' },
        });
        root.findByProps({ id: 'input-postal' }).props.onChange({
          target: { value: '110016' },
        });
      });

      // Jump to Step 5
      const findNextButton = () => {
        const buttons = root.findAllByType('button');
        return buttons.find(
          (b) =>
            b.props.className?.includes('primary') &&
            b.props.children?.some?.((c: any) => typeof c === 'string' && c.includes('Next Step')),
        );
      };

      for (let i = 0; i < 4; i++) {
        await act(async () => {
          findNextButton()?.props.onClick();
        });
      }

      // Fill Step 5 fields
      await act(async () => {
        root.findByProps({ id: 'vault-gmail' }).props.onChange({
          target: { value: 'user@aegis.local' },
        });
        root.findByProps({ id: 'vault-mobile' }).props.onChange({
          target: { value: '+91 98765 43210' },
        });
        root.findByProps({ id: 'vault-password' }).props.onChange({
          target: { value: 'MasterPassphrase2026!' },
        });
      });

      // Submit the form
      const form = root.findByProps({ className: 'vault-form' });
      await act(async () => {
        await form.props.onSubmit({ preventDefault: vi.fn() });
      });

      // Verify localStorage storage
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('aegis-onboarding-completed', 'true');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'aegis:user:vault',
        expect.any(String),
      );

      const savedVaultStr = localStorageStore['aegis:user:vault'];
      expect(savedVaultStr).toBeDefined();
      const savedRecord = JSON.parse(savedVaultStr);

      expect(savedRecord.name).toBe('Mohit Sharma');
      expect(savedRecord.gmailId).toBe('user@aegis.local');
      expect(savedRecord.passwordHash).toHaveLength(64);

      // Verify ciphertext can be decrypted with the master passphrase
      const decryptedPhone = await decryptData(savedRecord.phoneEncrypted, 'MasterPassphrase2026!');
      expect(decryptedPhone).toBe('+91 98765 43210');

      const decryptedAddress = await decryptData(
        savedRecord.addressEncrypted,
        'MasterPassphrase2026!',
      );
      expect(decryptedAddress).toContain('Block B, Green Park');
      expect(decryptedAddress).toContain('110016');

      // Verify api was called to sync to /memories. The modal may load geo
      // dictionaries first, so locate the memory write instead of assuming it
      // is the very first request.
      const memoryCall = mockApi.mock.calls.find(([path]) => path === '/memories');
      expect(memoryCall).toBeDefined();
      expect(memoryCall?.[1]).toBe('POST');
      expect((memoryCall?.[2] as any)?.text).toContain('[ENCRYPTED_VAULT]');

      // Verify success card is rendered
      expect(root.findByProps({ className: 'vault-success-card' })).toBeDefined();

      // Click "Launch Aegis Agent Workspace" button
      const finishBtn = root.findByProps({ className: 'finish-btn' });
      await act(async () => {
        finishBtn.props.onClick();
      });

      // Verify mascot celebration event was dispatched
      const mascotEvent = dispatchedEvents.find((e) => e.type === 'aegis:mascot');
      expect(mascotEvent).toBeDefined();
      expect(mascotEvent?.detail).toEqual({ state: 'celebrate' });

      // Verify onboarding-completed event was dispatched
      const completedEvent = dispatchedEvents.find((e) => e.type === 'aegis:onboarding-completed');
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.detail?.record?.name).toBe('Mohit Sharma');

      // Advance timers to trigger exit animation transition timeout (220ms)
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(onCompleted).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Mohit Sharma',
          gmailId: 'user@aegis.local',
        }),
      );
      expect(onClose).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('triggers exit animation on close button click and closes smoothly', async () => {
      vi.useFakeTimers();
      const onClose = vi.fn();

      let renderer: ReturnType<typeof create>;
      await act(async () => {
        renderer = create(<AgentOnboardingModal onClose={onClose} />);
      });

      const root = renderer!.root;
      const closeBtn = root.findByProps({ className: 'onboarding-close-btn' });

      await act(async () => {
        closeBtn.props.onClick();
      });

      // Verify closing class is added to overlay
      const overlay = root.find((node) =>
        node.props.className?.includes('onboarding-modal-overlay'),
      );
      expect(overlay?.props.className).toContain('closing');

      // Fast forward exit animation
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(onClose).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
