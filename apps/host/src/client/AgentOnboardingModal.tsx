import { useEffect, useRef, useState } from 'react';
import {
  X,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Smartphone,
  LocateFixed,
  MapPin,
  CloudSun,
  Loader2,
} from 'lucide-react';
import { api } from './api';
import { Mascot } from './Mascot';

export interface EncryptedVaultRecord {
  id: string;
  name: string;
  gmailId: string;
  phoneEncrypted: string;
  addressEncrypted: string;
  passwordHash: string;
  riskPolicies: string[];
  createdAt: number;
}

export interface EncryptedPayload {
  algorithm: 'AES-GCM';
  keyDerivation: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
}

function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Derive a 256-bit AES-GCM CryptoKey using PBKDF2 with SHA-256 and 100,000 iterations
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  usages: KeyUsage[] = ['encrypt', 'decrypt'],
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const subtle = globalThis.crypto?.subtle ?? crypto.subtle;
  const baseKey = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

// Encrypt plaintext with passphrase using Web Crypto API AES-GCM (12-byte random IV)
export async function encryptData(plaintext: string, passphrase: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle ?? crypto.subtle;
  const getRandomValues =
    globalThis.crypto?.getRandomValues?.bind(globalThis.crypto) ??
    crypto.getRandomValues.bind(crypto);

  const salt = getRandomValues(new Uint8Array(16));
  const iv = getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassphrase(passphrase, salt, ['encrypt']);
  const encodedPlaintext = new TextEncoder().encode(plaintext);

  const cipherBuffer = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encodedPlaintext,
  );

  const payload: EncryptedPayload = {
    algorithm: 'AES-GCM',
    keyDerivation: 'PBKDF2-SHA256',
    iterations: 100000,
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    ciphertext: bufferToBase64(cipherBuffer),
  };

  return btoa(JSON.stringify(payload));
}

// Decrypt ciphertext using passphrase and AES-GCM (fails if passphrase is wrong)
export async function decryptData(encodedPayload: string, passphrase: string): Promise<string> {
  let payload: EncryptedPayload;
  try {
    const jsonStr = atob(encodedPayload);
    payload = JSON.parse(jsonStr);
  } catch {
    payload = JSON.parse(encodedPayload);
  }

  const salt = base64ToUint8Array(payload.salt);
  const iv = base64ToUint8Array(payload.iv);
  const ciphertext = base64ToUint8Array(payload.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt, ['decrypt']);
  const subtle = globalThis.crypto?.subtle ?? crypto.subtle;

  const plainBuffer = await subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new TextDecoder().decode(plainBuffer);
}

// Cryptographic hash for verification
export async function sha256(message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle ?? crypto.subtle;
  const msgBuffer = new TextEncoder().encode(message + '_aegis_salt_2026');
  const hashBuffer = await subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Plain-language label for an Open-Meteo WMO weather code. */
export function weatherLabel(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code <= 2) return 'Mostly clear';
  if (code === 3) return 'Overcast';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorm';
}

interface WeatherNow {
  temperature: number;
  code: number;
  unit: string;
  place: string;
}

export function AgentOnboardingModal({
  onClose,
  onCompleted,
}: {
  onClose: () => void;
  onCompleted?: (record: EncryptedVaultRecord) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [isClosing, setIsClosing] = useState(false);

  // Step 1: Personal & Postal Identity
  const [fullName, setFullName] = useState('');
  const [country, setCountry] = useState('');
  const [stateRegion, setStateRegion] = useState('');
  const [city, setCity] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  // Geography comes from keyless public datasets through the host proxy, so an
  // owner can pick a real country -> state -> city instead of typing a string
  // the agent later has to guess at.
  const [countries, setCountries] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [geoNote, setGeoNote] = useState('');
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);
  const [weather, setWeather] = useState<WeatherNow | null>(null);

  const cityCountry = [city, stateRegion, country].filter(Boolean).join(', ');

  // A location fill sets country, state and city together; the dependent
  // effects below would otherwise clear the fields they just received.
  const pendingFill = useRef<{ country: string; state: string; city: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ countries: string[] }>('/geo/countries')
      .then((data) => {
        if (!cancelled) setCountries(data.countries ?? []);
      })
      .catch(() => {
        if (!cancelled)
          setGeoNote('Country list is unreachable; you can still type your country.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!country) {
      setStates([]);
      return;
    }
    const fill = pendingFill.current;
    let cancelled = false;
    setGeoBusy(true);
    setStates([]);
    setCities([]);
    if (!fill || fill.country !== country) {
      setStateRegion('');
      setCity('');
    }
    api<{ states: string[]; error?: string }>(
      `/geo/states?country=${encodeURIComponent(country)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setStates(data.states ?? []);
        if (!data.states?.length)
          setGeoNote('No state list for that country. Type your state or region.');
      })
      .catch(() => {
        if (!cancelled)
          setGeoNote('State list is unreachable. Type your state or region.');
      })
      .finally(() => {
        if (!cancelled) setGeoBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    if (!country || !stateRegion) {
      setCities([]);
      return;
    }
    const fill = pendingFill.current;
    let cancelled = false;
    setGeoBusy(true);
    setCities([]);
    if (!fill || fill.state !== stateRegion) setCity('');
    api<{ cities: string[]; error?: string }>(
      `/geo/cities?country=${encodeURIComponent(country)}&state=${encodeURIComponent(stateRegion)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setCities(data.cities ?? []);
        if (!data.cities?.length)
          setGeoNote('No city list for that state. Type your city.');
      })
      .catch(() => {
        if (!cancelled) setGeoNote('City list is unreachable. Type your city.');
      })
      .finally(() => {
        if (!cancelled) setGeoBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [country, stateRegion]);

  // Weather is a keyless Open-Meteo lookup, resolved from the chosen place.
  useEffect(() => {
    const place = city || stateRegion;
    if (!place) {
      setWeather(null);
      return;
    }
    let cancelled = false;
    const unit = /united states|liberia|myanmar/i.test(country)
      ? 'fahrenheit'
      : 'celsius';
    const timer = window.setTimeout(() => {
      api<{
        results: { name: string; lat: number; lon: number }[];
      }>(`/weather/place?name=${encodeURIComponent([place, country].filter(Boolean).join(', '))}`)
        .then((found) => {
          const first = found.results?.[0];
          if (!first || cancelled) return;
          return api<{
            current: Record<string, number>;
            unit: string;
          }>(`/weather?lat=${first.lat}&lon=${first.lon}&unit=${unit}`).then(
            (report) => {
              if (cancelled) return;
              const temperature = report.current?.temperature_2m;
              const code = report.current?.weather_code;
              if (typeof temperature !== 'number') return;
              setWeather({
                temperature,
                code: typeof code === 'number' ? code : 0,
                unit: report.unit ?? unit,
                place: first.name || place,
              });
            },
          );
        })
        .catch(() => {
          // Weather is a nicety; the postal address still saves.
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [city, stateRegion, country]);

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoNote('This build has no location service. Pick your country below.');
      return;
    }
    setGeoBusy(true);
    setGeoDenied(false);
    setGeoNote('');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void api<{
          country: string;
          state: string;
          city: string;
          postalCode: string;
        }>(
          `/geo/reverse?lat=${position.coords.latitude}&lon=${position.coords.longitude}`,
        )
          .then((place) => {
            pendingFill.current = {
              country: place.country,
              state: place.state,
              city: place.city,
            };
            setCountry(place.country);
            setStateRegion(place.state);
            setCity(place.city);
            if (place.postalCode && !postalCode) setPostalCode(place.postalCode);
            setGeoNote(
              `Located ${[place.city, place.state, place.country]
                .filter(Boolean)
                .join(', ')}`,
            );
          })
          .catch(() => {
            setGeoNote('Could not resolve that location. Pick your country below.');
          })
          .finally(() => setGeoBusy(false));
      },
      () => {
        setGeoBusy(false);
        setGeoDenied(true);
        setGeoNote('Location permission was declined. Pick your country below.');
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  };

  // Step 2: Google Workspace
  const [googleConnected, setGoogleConnected] = useState(false);
  const [gmailAddress, setGmailAddress] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');

  // Step 3: WhatsApp & Phone
  const [mobileNumber, setMobileNumber] = useState('');
  const [whatsAppPaired, setWhatsAppPaired] = useState(false);

  // Step 4: Data Misproduction & Risk Policies
  const [riskPolicies, setRiskPolicies] = useState<string[]>([
    'require_approval_payments',
    'mask_pii_audit',
  ]);

  // Step 5: Generative UI Sensitive Credentials Intake
  const [masterPassword, setMasterPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [vaultSaved, setVaultSaved] = useState<EncryptedVaultRecord | null>(null);

  const togglePolicy = (policy: string) => {
    setRiskPolicies((prev) =>
      prev.includes(policy) ? prev.filter((p) => p !== policy) : [...prev, policy],
    );
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 220);
  };

  const handleLaunchWorkspace = (recordToFinish?: EncryptedVaultRecord | null) => {
    const finalRecord = recordToFinish || vaultSaved;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('aegis:mascot', { detail: { state: 'celebrate' } }),
      );
      if (finalRecord) {
        window.dispatchEvent(
          new CustomEvent('aegis:onboarding-completed', { detail: { record: finalRecord } }),
        );
      }
    }
    setIsClosing(true);
    setTimeout(() => {
      if (finalRecord) {
        onCompleted?.(finalRecord);
      }
      onClose();
    }, 220);
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const hashedPass = masterPassword ? await sha256(masterPassword) : '';
      const encPhone = await encryptData(mobileNumber, masterPassword);
      const encAddress = await encryptData(
        `${streetAddress}, ${postalCode}, ${cityCountry}`,
        masterPassword,
      );

      const record: EncryptedVaultRecord = {
        id: `vault-${Date.now()}`,
        name: fullName || 'User',
        gmailId: gmailAddress,
        phoneEncrypted: encPhone,
        addressEncrypted: encAddress,
        passwordHash: hashedPass,
        riskPolicies,
        createdAt: Date.now(),
      };

      // Persist to local memory with encrypted header
      const memoryPayload = `[ENCRYPTED_VAULT] User Identity: ${record.name} | Gmail: ${record.gmailId || 'unlinked'} | EncryptedPhone: ${record.phoneEncrypted} | EncryptedAddress: ${record.addressEncrypted} | PasswordHash: ${record.passwordHash} | RiskPolicies: ${record.riskPolicies.join(',')}`;

      await api<{ id?: string }>('/memories', 'POST', { text: memoryPayload }).catch(() => null);

      // A readable profile memory so the owner's onboarding data actually shows
      // up in Personal Memory and shapes every later answer. No secrets here:
      // phone, address and password stay only in the encrypted vault record.
      const profileParts = [
        record.name ? `Name: ${record.name}` : '',
        record.gmailId ? `Gmail: ${record.gmailId}` : '',
        [streetAddress, postalCode, cityCountry].filter(Boolean).join(', ')
          ? `Location: ${[streetAddress, postalCode, cityCountry].filter(Boolean).join(', ')}`
          : '',
        record.riskPolicies.length
          ? `Data risk policies: ${record.riskPolicies.join(', ')}`
          : '',
      ].filter(Boolean);
      if (profileParts.length) {
        await api<{ id?: string }>('/memories', 'POST', {
          text: `Owner profile (from onboarding) — ${profileParts.join('; ')}.`,
        }).catch(() => null);
      }

      try {
        localStorage.setItem('aegis:user:vault', JSON.stringify(record));
        localStorage.setItem('aegis-onboarding-completed', 'true');
      } catch (err) {
        console.warn('LocalStorage save failed:', err);
      }

      setVaultSaved(record);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`onboarding-modal-overlay ${isClosing ? 'closing' : ''}`}>
      <div className="onboarding-modal-container">
        {/* Header */}
        <div className="onboarding-header">
          <div className="onboarding-header-left">
            <div className="onboarding-mascot" aria-hidden="true">
              <Mascot state="speaking" size={42} decorative />
            </div>
            <div className="onboarding-heading">
              <h3 className="onboarding-title">Agent Profile &amp; Vault Setup</h3>
              <p className="onboarding-subtitle">
                Five short steps. Everything stays on this computer.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="onboarding-close-btn"
            onClick={handleClose}
            aria-label="Close Onboarding"
          >
            <X size={16} />
          </button>
        </div>

        {/* Step Progression Indicators */}
        <div className="onboarding-step-tracker">
          {[
            { num: 1, label: 'Identity & Postal' },
            { num: 2, label: 'Google Workspace' },
            { num: 3, label: 'WhatsApp' },
            { num: 4, label: 'Data Risk Gating' },
            { num: 5, label: 'Secure Vault' },
          ].map((s) => (
            <div
              key={s.num}
              className={`onboarding-step-item ${step === s.num ? 'active' : ''} ${step > s.num ? 'completed' : ''}`}
            >
              <div className="step-circle">
                {step > s.num ? <CheckCircle2 size={13} /> : s.num}
              </div>
              <span className="step-label">{s.label}</span>
            </div>
          ))}
        </div>

        {/* Body Content by Step */}
        <div className="onboarding-body">
          {/* STEP 1: Personal & Postal Details */}
          {step === 1 && (
            <div className="onboarding-step-view">
              <div className="agent-speech-bubble">
                <div className="agent-speech-avatar">
                  <ShieldCheck size={18} />
                </div>
                <div className="agent-speech-content">
                  <strong>Aegis Security Assistant</strong>
                  <p>
                    &ldquo;Welcome to Aegis! Let&rsquo;s get you onboarded. What is your name and where do you live? Our personal and postal agents require precise postal delivery details to coordinate local operations and deliveries for you.&rdquo;
                  </p>
                </div>
              </div>

              <div className="generative-vault-card">
                <div className="vault-field-group">
                  <label htmlFor="input-fullname">Full Legal Name:</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-fullname"
                      type="text"
                      placeholder="e.g. John Doe"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                    {fullName.trim().length > 0 && (
                      <CheckCircle2 size={14} className="input-valid-icon" />
                    )}
                  </div>
                </div>

                <div className="vault-field-group">
                  <div className="geo-heading">
                    <label htmlFor="input-city">Where you live:</label>
                    <button
                      type="button"
                      className={`geo-use${geoDenied ? ' denied' : ''}`}
                      onClick={useMyLocation}
                      disabled={geoBusy}
                    >
                      {geoBusy ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <LocateFixed size={13} />
                      )}
                      Use my location
                    </button>
                  </div>
                  <div className="geo-grid">
                    <div className="generative-input-wrapper">
                      <MapPin size={14} className="geo-icon" />
                      <input
                        id="input-country"
                        type="text"
                        list="geo-countries"
                        placeholder="Country"
                        autoComplete="country-name"
                        value={country}
                        onChange={(event) => {
                          pendingFill.current = null;
                          setCountry(event.target.value);
                        }}
                      />
                      <datalist id="geo-countries">
                        {countries.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="generative-input-wrapper">
                      <input
                        id="input-state"
                        type="text"
                        list="geo-states"
                        placeholder="State or region"
                        autoComplete="address-level1"
                        value={stateRegion}
                        onChange={(event) => {
                          pendingFill.current = null;
                          setStateRegion(event.target.value);
                        }}
                      />
                      <datalist id="geo-states">
                        {states.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="generative-input-wrapper">
                      <input
                        id="input-city"
                        type="text"
                        list="geo-cities"
                        placeholder="City"
                        autoComplete="address-level2"
                        value={city}
                        onChange={(event) => {
                          pendingFill.current = null;
                          setCity(event.target.value);
                        }}
                      />
                      <datalist id="geo-cities">
                        {cities.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                      {city.trim().length > 0 && (
                        <CheckCircle2 size={14} className="input-valid-icon" />
                      )}
                    </div>
                  </div>

                  <div className="geo-foot">
                    {geoNote ? (
                      <p className="geo-status">{geoNote}</p>
                    ) : (
                      <p className="geo-status muted">
                        Country, state and city data from CountriesNow; weather from
                        Open-Meteo. No API key needed.
                      </p>
                    )}
                    {weather && (
                      <span className="geo-weather" title="Current conditions">
                        <CloudSun size={14} />
                        {Math.round(weather.temperature)}&deg;
                        {weather.unit === 'fahrenheit' ? 'F' : 'C'} &middot;{' '}
                        {weatherLabel(weather.code)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="vault-field-group">
                  <label htmlFor="input-street">Street Delivery Address (Postal Agent):</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-street"
                      type="text"
                      placeholder="e.g. Flat 402, Green Avenue, Sector 15"
                      value={streetAddress}
                      onChange={(e) => setStreetAddress(e.target.value)}
                    />
                    {streetAddress.trim().length > 0 && (
                      <CheckCircle2 size={14} className="input-valid-icon" />
                    )}
                  </div>
                </div>

                <div className="vault-field-group">
                  <label htmlFor="input-postal">Postal / ZIP Code:</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-postal"
                      type="text"
                      placeholder="e.g. 110001 or 94107"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                    />
                    {postalCode.trim().length > 0 && (
                      <CheckCircle2 size={14} className="input-valid-icon" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Google Workspace */}
          {step === 2 && (
            <div className="onboarding-step-view">
              <div className="agent-speech-bubble">
                <div className="agent-speech-avatar">
                  <ShieldCheck size={18} />
                </div>
                <div className="agent-speech-content">
                  <strong>Aegis Workspace Coordinator</strong>
                  <p>
                    &ldquo;Connect your Google Workspace (Gmail, Docs, Drive, Calendar) so I can organize your communications, draft replies, and track your schedule with full consent.&rdquo;
                  </p>
                </div>
              </div>

              <div className="google-workspace-card">
                <div className="card-top-row">
                  <div className="google-icon-box">G</div>
                  <div>
                    <strong>Google Workspace Connection</strong>
                    <p>OAuth 2.0 integration for Gmail & Google Drive</p>
                  </div>
                  <span className={`status-pill ${googleConnected ? 'connected' : 'unlinked'}`}>
                    {googleConnected ? 'CONNECTED' : 'UNLINKED'}
                  </span>
                </div>

                <div className="vault-field-group">
                  <label htmlFor="input-gmail">Google Account / Gmail Address:</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-gmail"
                      type="email"
                      placeholder="e.g. your.name@gmail.com"
                      value={gmailAddress}
                      onChange={(e) => setGmailAddress(e.target.value)}
                    />
                    {gmailAddress.includes('@') && (
                      <CheckCircle2 size={14} className="input-valid-icon" />
                    )}
                  </div>
                </div>

                <div className="vault-field-group">
                  <label htmlFor="input-google-client-id">Google OAuth Client ID (Optional):</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-google-client-id"
                      type="text"
                      placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  className="connect-google-btn"
                  onClick={() => setGoogleConnected(!googleConnected)}
                >
                  {googleConnected ? 'Disconnect Google Account' : 'Authenticate Google Workspace'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: WhatsApp & Mobile Number */}
          {step === 3 && (
            <div className="onboarding-step-view">
              <div className="agent-speech-bubble">
                <div className="agent-speech-avatar">
                  <ShieldCheck size={18} />
                </div>
                <div className="agent-speech-content">
                  <strong>Aegis Mobile Dispatcher</strong>
                  <p>
                    &ldquo;Let&rsquo;s connect WhatsApp and confirm your mobile phone number. This empowers me to deliver urgent alerts, schedule briefs, and accept commands on the go.&rdquo;
                  </p>
                </div>
              </div>

              <div className="whatsapp-setup-card">
                <div className="card-top-row">
                  <Smartphone size={24} className="phone-icon" />
                  <div>
                    <strong>WhatsApp & Mobile Notification Channel</strong>
                    <p>Direct mobile access via supervised sidecar</p>
                  </div>
                  <span className={`status-pill ${whatsAppPaired ? 'connected' : 'unlinked'}`}>
                    {whatsAppPaired ? 'PAIRED' : 'AWAITING PAIR'}
                  </span>
                </div>

                <div className="vault-field-group">
                  <label htmlFor="input-mobile">Mobile Phone Number (with Country Code):</label>
                  <div className="generative-input-wrapper">
                    <input
                      id="input-mobile"
                      type="tel"
                      placeholder="+91 98765 43210 or +1 415 555 2671"
                      value={mobileNumber}
                      onChange={(e) => setMobileNumber(e.target.value)}
                    />
                    {mobileNumber.trim().length > 3 && (
                      <CheckCircle2 size={14} className="input-valid-icon" />
                    )}
                  </div>
                </div>

                <div className="qr-preview-box">
                  <div className="qr-box-mock">
                    <span className="qr-label">WhatsApp Web QR Scanner</span>
                    <small>Pair with your phone: Linked Devices &rarr; Link a device</small>
                  </div>
                  <button
                    type="button"
                    className="pair-whatsapp-btn"
                    onClick={() => setWhatsAppPaired(!whatsAppPaired)}
                  >
                    {whatsAppPaired ? 'Unlink Device' : 'Simulate Pairing Device'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Data Misproduction & Risk Policies */}
          {step === 4 && (
            <div className="onboarding-step-view">
              <div className="agent-speech-bubble">
                <div className="agent-speech-avatar">
                  <ShieldCheck size={18} />
                </div>
                <div className="agent-speech-content">
                  <strong>Aegis Privacy Guard</strong>
                  <p>
                    &ldquo;Your data privacy and system safety come first. What sensitive domains or operational areas should have strict risk gating to prevent accidental data misproduction?&rdquo;
                  </p>
                </div>
              </div>

              <div className="risk-policy-grid">
                {[
                  {
                    id: 'require_approval_payments',
                    title: 'Financial Transactions & Payments Gate',
                    desc: 'Never execute payment checkouts, credit card entries, or bank transfers without explicit human confirmation.',
                  },
                  {
                    id: 'mask_pii_audit',
                    title: 'Mask PII & Credentials in Audit Logs',
                    desc: 'Automatically mask phone numbers, street addresses, and secrets in local log files and trace viewers.',
                  },
                  {
                    id: 'block_db_mutations',
                    title: 'Production Database Mutation Prevention',
                    desc: 'Prohibit DROP TABLE, TRUNCATE, and unindexed bulk deletes across connected databases.',
                  },
                  {
                    id: 'confirm_email_send',
                    title: 'External Email & Message Confirmation',
                    desc: 'Draft emails and WhatsApp messages as previews; require manual user review before outbound transmission.',
                  },
                ].map((pol) => {
                  const active = riskPolicies.includes(pol.id);
                  return (
                    <div
                      key={pol.id}
                      className={`risk-policy-card ${active ? 'active' : ''}`}
                      onClick={() => togglePolicy(pol.id)}
                      role="button"
                      tabIndex={0}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => togglePolicy(pol.id)}
                        aria-label={pol.title}
                      />
                      <div className="risk-policy-info">
                        <strong>{pol.title}</strong>
                        <span>{pol.desc}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 5: Generative UI - Secure Credentials Intake & Hashing */}
          {step === 5 && (
            <div className="onboarding-step-view">
              <div className="agent-speech-bubble">
                <div className="agent-speech-avatar">
                  <ShieldCheck size={18} />
                </div>
                <div className="agent-speech-content">
                  <strong>Aegis Cryptographic Vault</strong>
                  <p>
                    &ldquo;Here is the secure generative intake component. Enter your master credentials. All personal data will be encrypted in local memory using 256-bit AES-GCM derived via PBKDF2 with 100,000 iterations.&rdquo;
                  </p>
                </div>
              </div>

              {!vaultSaved ? (
                <div className="generative-vault-card">
                  <div className="vault-security-banner">
                    <Lock size={16} className="lock-icon" />
                    <span>
                      Encrypted memory storage &middot; Client-side PBKDF2 (SHA-256, 100k iter) & 256-bit AES-GCM
                    </span>
                  </div>

                  <form onSubmit={handleFinalSubmit} className="vault-form">
                    <div className="vault-field-group">
                      <label htmlFor="vault-gmail">Confirmed Gmail ID:</label>
                      <div className="generative-input-wrapper">
                        <input
                          id="vault-gmail"
                          type="email"
                          value={gmailAddress}
                          onChange={(e) => setGmailAddress(e.target.value)}
                          placeholder="your.email@gmail.com"
                          required
                        />
                        {gmailAddress.includes('@') && (
                          <CheckCircle2 size={14} className="input-valid-icon" />
                        )}
                      </div>
                    </div>

                    <div className="vault-field-group">
                      <label htmlFor="vault-mobile">Confirmed Mobile Phone:</label>
                      <div className="generative-input-wrapper">
                        <input
                          id="vault-mobile"
                          type="tel"
                          value={mobileNumber}
                          onChange={(e) => setMobileNumber(e.target.value)}
                          placeholder="+1 555-0192"
                          required
                        />
                        {mobileNumber.trim().length > 3 && (
                          <CheckCircle2 size={14} className="input-valid-icon" />
                        )}
                      </div>
                    </div>

                    <div className="vault-field-group">
                      <label htmlFor="vault-password">
                        Master Passphrase / App Password (Derives Encryption Key):
                      </label>
                      <div className="password-input-wrapper">
                        <input
                          id="vault-password"
                          type={showPassword ? 'text' : 'password'}
                          value={masterPassword}
                          onChange={(e) => setMasterPassword(e.target.value)}
                          placeholder="Enter secret master passphrase..."
                          required
                        />
                        <button
                          type="button"
                          className="password-toggle-btn"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                      <div className="vault-security-hint">
                        <ShieldCheck size={12} /> Key derived using PBKDF2 with SHA-256 (100,000 iterations). Encrypted via AES-GCM-256. Never stored raw.
                      </div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <button
                        type="submit"
                        disabled={isSubmitting || !masterPassword}
                        className="save-vault-btn"
                      >
                        {isSubmitting
                          ? 'Deriving Key & Encrypting...'
                          : 'Encrypt & Save to Local Memory Vault'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="vault-success-card">
                  <div className="success-badge">
                    <ShieldCheck size={28} />
                    <strong>Onboarding Completed & Memory Encrypted!</strong>
                  </div>
                  <p className="vault-success-copy">
                    Your personal profile, postal address, and credentials have been securely encrypted using AES-GCM (PBKDF2 SHA-256 derived key) and stored in local memory.
                  </p>
                  <div className="encrypted-summary-box">
                    <div>
                      <span>Account Holder:</span>
                      <strong>{vaultSaved.name}</strong>
                    </div>
                    <div>
                      <span>Gmail:</span>
                      <strong>{vaultSaved.gmailId || 'unlinked'}</strong>
                    </div>
                    <div>
                      <span>Encrypted Phone (AES-GCM):</span>
                      <code>{vaultSaved.phoneEncrypted}</code>
                    </div>
                    <div>
                      <span>Encrypted Address (AES-GCM):</span>
                      <code>{vaultSaved.addressEncrypted}</code>
                    </div>
                    <div>
                      <span>Password SHA-256 Hash:</span>
                      <code>{vaultSaved.passwordHash.slice(0, 24)}...</code>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="finish-btn"
                    onClick={() => handleLaunchWorkspace(vaultSaved)}
                  >
                    Launch Aegis Agent Workspace
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        {!vaultSaved && (
          <div className="onboarding-footer">
            <button
              type="button"
              className="secondary"
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3 | 4 | 5)}
            >
              <ArrowLeft size={14} /> Back
            </button>
            {step < 5 ? (
              <button
                type="button"
                className="primary"
                onClick={() => setStep((s) => Math.min(5, s + 1) as 1 | 2 | 3 | 4 | 5)}
              >
                Next Step <ArrowRight size={14} />
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
