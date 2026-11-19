import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

export function MicrosoftOfficeIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="2" width="9" height="9" fill="#F25022" rx="1" />
      <rect x="13" y="2" width="9" height="9" fill="#7FBA00" rx="1" />
      <rect x="2" y="13" width="9" height="9" fill="#00A4EF" rx="1" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" rx="1" />
    </svg>
  );
}

export function WindowsIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2 3.8L9.5 2.8V11.2H2V3.8ZM10.5 2.6L22 1V11.2H10.5V2.6ZM2 12.8H9.5V21.2L2 20.2V12.8ZM10.5 12.8H22V23L10.5 21.4V12.8Z"
        fill="#0078D4"
      />
    </svg>
  );
}

export function AwsS3Icon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L3 6.5V17.5L12 22L21 17.5V6.5L12 2Z"
        fill="#E05243"
      />
      <path
        d="M12 2L21 6.5V17.5L12 22V2Z"
        fill="#C93B2B"
      />
      <path
        d="M12 4.2L5.2 7.6V16.4L12 19.8L18.8 16.4V7.6L12 4.2Z"
        fill="#F3F4F6"
        fillOpacity="0.25"
      />
      <path
        d="M12 6.5L7.5 8.75V15.25L12 17.5L16.5 15.25V8.75L12 6.5Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function AwsLambdaIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L3 6.5V17.5L12 22L21 17.5V6.5L12 2Z"
        fill="#FF9900"
      />
      <path
        d="M12 2L21 6.5V17.5L12 22V2Z"
        fill="#E68A00"
      />
      <path
        d="M8.2 16.5L9.6 13.7L12 16.5H15.5L11.5 11.8L13.8 7.5H11.8L10.3 10.3L9.1 7.5H7L8.7 11.5L6.5 16.5H8.2Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

export function AwsIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 3C7.03 3 3 7.03 3 12C3 16.97 7.03 21 12 21C16.97 21 21 16.97 21 12C21 7.03 16.97 3 12 3Z"
        fill="#232F3E"
      />
      <path
        d="M16.5 14.8C15.2 15.6 13.5 16 11.8 16C9.3 16 7.2 15.1 5.8 13.6C5.6 13.4 5.7 13.1 6 13.2C7.3 14 9.1 14.6 11.3 14.6C12.9 14.6 14.7 14.1 16.2 13.2C16.6 13 16.9 13.4 16.5 14.8Z"
        fill="#FF9900"
      />
      <path
        d="M17.2 13.8C16.9 13.5 16.1 13.7 15.6 13.9C15.4 14 15.5 14.2 15.7 14.3C16.3 14.6 17.1 14.8 17.3 14.6C17.5 14.4 17.4 14 17.2 13.8Z"
        fill="#FF9900"
      />
    </svg>
  );
}

export function GoogleCloudIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04Z"
        fill="#EA4335"
      />
      <path
        d="M19.35 10.04C18.67 6.59 15.64 4 12 4C10.74 4 9.56 4.34 8.54 4.94L11.5 9.5H19.35Z"
        fill="#4285F4"
      />
      <path
        d="M5.35 8.04C6.6 5.64 9.11 4 12 4C10.74 4 9.56 4.34 8.54 4.94L5.35 8.04Z"
        fill="#34A853"
      />
      <path
        d="M19 20H6C2.69 20 0 17.31 0 14C0 12.44 0.6 11.02 1.58 9.96L7.5 15.5H19V20Z"
        fill="#FBBC05"
      />
      <path
        d="M19.35 10.04C21.95 10.22 24 12.36 24 15C24 17.76 21.76 20 19 20V10.04Z"
        fill="#4285F4"
      />
    </svg>
  );
}

export function BigQueryIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="11" cy="11" r="8" fill="#4285F4" />
      <circle cx="11" cy="11" r="5.5" fill="#FFFFFF" />
      <path
        d="M9 8.5H13V10H9V8.5ZM9 11H13V12.5H9V11ZM9 13.5H12V15H9V13.5Z"
        fill="#4285F4"
      />
      <path
        d="M15.5 15.5L21.5 21.5"
        stroke="#4285F4"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function AzureIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.2 2.5L4.8 15.2L10.5 17.8L13.2 2.5Z"
        fill="#0089D6"
      />
      <path
        d="M13.2 2.5L10.5 17.8L18.8 21.5L21.5 16.5L13.2 2.5Z"
        fill="#0078D4"
      />
      <path
        d="M4.8 15.2L2.5 19.2C2.1 19.9 2.6 20.8 3.4 20.8H14.8L10.5 17.8L4.8 15.2Z"
        fill="#005BA1"
      />
    </svg>
  );
}

export function GitHubIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017C2 16.446 4.87 20.198 8.84 21.52C9.34 21.61 9.52 21.3 9.52 21.03C9.52 20.79 9.51 20.16 9.51 19.32C6.73 19.93 6.14 17.98 6.14 17.98C5.68 16.82 5.03 16.51 5.03 16.51C4.12 15.89 5.1 15.9 5.1 15.9C6.1 15.97 6.63 16.93 6.63 16.93C7.52 18.46 8.97 18.02 9.54 17.76C9.63 17.11 9.89 16.67 10.17 16.42C7.95 16.17 5.62 15.31 5.62 11.5C5.62 10.39 6.01 9.49 6.65 8.79C6.55 8.54 6.2 7.5 6.75 6.15C6.75 6.15 7.59 5.88 9.5 7.17C10.3 6.95 11.15 6.84 12 6.84C12.85 6.84 13.7 6.95 14.5 7.17C16.41 5.88 17.25 6.15 17.25 6.15C17.8 7.5 17.45 8.54 17.35 8.79C17.99 9.49 18.38 10.39 18.38 11.5C18.38 15.32 16.04 16.16 13.81 16.41C14.17 16.72 14.49 17.33 14.49 18.26C14.49 19.6 14.48 20.68 14.48 21.03C14.48 21.3 14.66 21.62 15.17 21.52C19.14 20.19 22 16.44 22 12.017C22 6.484 17.522 2 12 2Z"
      />
    </svg>
  );
}

export function SlackIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M5.04 14.54C5.04 15.82 4 16.86 2.72 16.86C1.44 16.86 0.4 15.82 0.4 14.54C0.4 13.26 1.44 12.22 2.72 12.22H5.04V14.54ZM6.18 14.54C6.18 13.26 7.22 12.22 8.5 12.22C9.78 12.22 10.82 13.26 10.82 14.54V20.34C10.82 21.62 9.78 22.66 8.5 22.66C7.22 22.66 6.18 21.62 6.18 20.34V14.54Z"
        fill="#E01E5A"
      />
      <path
        d="M9.46 5.04C8.18 5.04 7.14 4 7.14 2.72C7.14 1.44 8.18 0.4 9.46 0.4C10.74 0.4 11.78 1.44 11.78 2.72V5.04H9.46ZM9.46 6.18C10.74 6.18 11.78 7.22 11.78 8.5C11.78 9.78 10.74 10.82 9.46 10.82H3.66C2.38 10.82 1.34 9.78 1.34 8.5C1.34 7.22 2.38 6.18 3.66 6.18H9.46Z"
        fill="#36C5F0"
      />
      <path
        d="M18.96 9.46C18.96 8.18 20 7.14 21.28 7.14C22.56 7.14 23.6 8.18 23.6 9.46C23.6 10.74 22.56 11.78 21.28 11.78H18.96V9.46ZM17.82 9.46C17.82 10.74 16.78 11.78 15.5 11.78C14.22 11.78 13.18 10.74 13.18 9.46V3.66C13.18 2.38 14.22 1.34 15.5 1.34C16.78 1.34 17.82 2.38 17.82 3.66V9.46Z"
        fill="#2EB67D"
      />
      <path
        d="M14.54 18.96C15.82 18.96 16.86 20 16.86 21.28C16.86 22.56 15.82 23.6 14.54 23.6C13.26 23.6 12.22 22.56 12.22 21.28V18.96H14.54ZM14.54 17.82C13.26 17.82 12.22 16.78 12.22 15.5C12.22 14.22 13.26 13.18 14.54 13.18H20.34C21.62 13.18 22.66 14.22 22.66 15.5C22.66 16.78 21.62 17.82 20.34 17.82H14.54Z"
        fill="#ECB22E"
      />
    </svg>
  );
}

export function NotionIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l11.43-.84c.373 0 .186-.373.093-.466L16.586 2.1c-.466-.373-.84-.28-1.586-.187L3.993 3.09c-.56.046-.466.42-.093.746l.56.373zm.84 3.733v12.227c0 .84.466 1.12 1.306 1.026l12.41-.886c.84-.047.887-.653.887-1.213V7.054c0-.653-.28-.933-.933-.886L5.85 7.054c-.56.047-.56.467-.56.887h.008zm11.39.467c.093.373 0 .746-.373.793l-.84.14v8.4c-.42.233-.887.373-1.353.373-.7 0-1.073-.233-1.633-.933l-4.153-6.533v6.393l1.306.28c.094.047.14.373.14.56 0 .187-.046.28-.42.28H6.98c-.14 0-.327-.047-.327-.28 0-.187.094-.513.374-.56l1.026-.233V9.255L6.84 9.115c-.093-.047-.14-.373-.14-.56 0-.187.047-.28.42-.28l3.453-.233c.42 0 .84.28 1.167.746l4.246 6.58v-5.88l-1.073-.14c-.094-.047-.14-.374-.14-.56 0-.187.046-.28.42-.28l2.493-.187c.28 0 .42.047.466.28v.006z" />
    </svg>
  );
}

export function DiscordIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
        fill="#5865F2"
      />
    </svg>
  );
}

export function SupabaseIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.25 2L3.5 13.75H11.5L10.75 22L20.5 10.25H12.5L13.25 2Z"
        fill="#3ECF8E"
      />
      <path
        d="M11.5 13.75L13.25 2L20.5 10.25H12.5L11.5 13.75Z"
        fill="#24B47E"
      />
    </svg>
  );
}

export function CloudflareIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M18.2 11.2C17.7 8.3 15.2 6.2 12.2 6.2C9.8 6.2 7.7 7.5 6.6 9.5C4.2 9.8 2.3 11.8 2.3 14.3C2.3 17 4.5 19.2 7.2 19.2H18C20.2 19.2 22 17.4 22 15.2C22 13.1 20.3 11.5 18.2 11.2Z"
        fill="#F38020"
      />
      <path
        d="M18 19.2H14.5L15.6 15.2C15.8 14.5 16.4 14.1 17.1 14.1H18.2C19.3 14.1 20.2 14.7 20.6 15.6C20.2 17.7 18.4 19.2 18 19.2Z"
        fill="#FAAE40"
      />
    </svg>
  );
}

export function DockerIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.5 11.8C22.1 11.6 21.1 11.4 20.3 11.9C20.1 11.1 19.6 10.4 18.8 10.1L18.3 9.9L18 10.4C17.6 11.1 17.4 12 17.5 12.8C16.8 13.2 15.8 13.4 14.5 13.4H2.4C2.1 14.5 2.5 17.5 5 19C7.4 20.4 11.5 20.4 14.7 18.7C18.2 16.9 20.2 14.4 20.7 12.6C21.4 12.6 22.1 12.3 22.5 11.8Z"
        fill="#2496ED"
      />
      <rect x="7" y="10.4" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="9.6" y="10.4" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="12.2" y="10.4" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="7" y="7.9" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="9.6" y="7.9" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="12.2" y="7.9" width="2.1" height="2" fill="#2496ED" rx="0.3" />
      <rect x="9.6" y="5.4" width="2.1" height="2" fill="#2496ED" rx="0.3" />
    </svg>
  );
}

export function KubernetesIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" fill="#326CE5" />
      <path
        d="M12 5.5L17.5 8.7V15.3L12 18.5L6.5 15.3V8.7L12 5.5Z"
        stroke="#FFFFFF"
        strokeWidth="1.4"
      />
      <circle cx="12" cy="12" r="2.2" fill="#FFFFFF" />
      <path
        d="M12 5.5V9.8M17.5 8.7L13.8 10.9M17.5 15.3L13.8 13.1M12 18.5V14.2M6.5 15.3L10.2 13.1M6.5 8.7L10.2 10.9"
        stroke="#FFFFFF"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function PostgresIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2Z"
        fill="#336791"
      />
      <path
        d="M16.5 10.5C16.3 8.3 14.8 6.5 12.3 6.5C9.4 6.5 7.6 8.8 7.6 11.9C7.6 15 9.2 17.5 12.3 17.5C14.1 17.5 15.5 16.5 16.1 15.1L14.3 14.4C13.9 15.2 13.2 15.7 12.3 15.7C10.5 15.7 9.6 14.2 9.6 11.9C9.6 9.6 10.6 8.3 12.3 8.3C13.6 8.3 14.4 9.2 14.6 10.5H16.5Z"
        fill="#FFFFFF"
      />
      <circle cx="11.2" cy="10.8" r="0.8" fill="#336791" />
    </svg>
  );
}

export function RedisIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M21.5 8.7L12 3.8L2.5 8.7L12 13.6L21.5 8.7Z"
        fill="#DC382D"
      />
      <path
        d="M2.5 11.3L12 16.2L21.5 11.3L19.5 10.3L12 14.1L4.5 10.3L2.5 11.3Z"
        fill="#A3241C"
      />
      <path
        d="M2.5 15.3L12 20.2L21.5 15.3L19.5 14.3L12 18.1L4.5 14.3L2.5 15.3Z"
        fill="#7A1B15"
      />
    </svg>
  );
}

export function MongoDbIcon({ size = 20, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2.2C11.8 2.2 11.5 2.5 11.4 2.8C9.5 5.5 6.2 10.2 6.2 14.5C6.2 18.5 9 21.2 11.6 21.8V12.5H12.4V21.8C15 21.2 17.8 18.5 17.8 14.5C17.8 10.2 14.5 5.5 12.6 2.8C12.5 2.5 12.2 2.2 12 2.2Z"
        fill="#13AA52"
      />
      <path
        d="M12 2.2V21.8C15 21.2 17.8 18.5 17.8 14.5C17.8 10.2 14.5 5.5 12.6 2.8C12.5 2.5 12.2 2.2 12 2.2Z"
        fill="#116149"
      />
    </svg>
  );
}

/**
 * Returns an authentic brand SVG logo if the item matches one of the major providers.
 */
export function getBrandLogo(
  item: { name: string; publisher?: string; command?: string; tags?: string[] },
  size = 20
): React.ReactElement | null {
  const combined = [
    item.name,
    item.publisher ?? '',
    item.command ?? '',
    ...(item.tags ?? []),
  ]
    .join(' ')
    .toLowerCase();

  // 1. AWS S3
  if (
    combined.includes('s3') ||
    combined.includes('aws-s3') ||
    combined.includes('aws s3')
  ) {
    return <AwsS3Icon size={size} />;
  }

  // 2. AWS Lambda
  if (
    combined.includes('lambda') ||
    combined.includes('aws-lambda') ||
    combined.includes('aws lambda')
  ) {
    return <AwsLambdaIcon size={size} />;
  }

  // Generic AWS / EC2 / CloudFormation
  if (
    combined.includes('aws') ||
    combined.includes('amazon') ||
    combined.includes('cloudformation') ||
    combined.includes('ec2')
  ) {
    return <AwsIcon size={size} />;
  }

  // 4. BigQuery
  if (combined.includes('bigquery')) {
    return <BigQueryIcon size={size} />;
  }

  // 3. Google Cloud Platform
  if (
    combined.includes('google cloud') ||
    combined.includes('gcp') ||
    combined.includes('google-cloud')
  ) {
    return <GoogleCloudIcon size={size} />;
  }

  // Microsoft Office (Word, Excel, PowerPoint)
  if (
    combined.includes('office') ||
    combined.includes('excel') ||
    combined.includes('word') ||
    combined.includes('powerpoint')
  ) {
    return <MicrosoftOfficeIcon size={size} />;
  }

  // Windows OS / Accessibility
  if (combined.includes('windows') || combined.includes('win32')) {
    return <WindowsIcon size={size} />;
  }

  // 5. Azure Resource Manager / Microsoft Azure
  if (
    combined.includes('azure') ||
    combined.includes('microsoft azure') ||
    combined.includes('arm')
  ) {
    return <AzureIcon size={size} />;
  }

  // 6. GitHub
  if (combined.includes('github') || combined.includes('git-hub')) {
    return <GitHubIcon size={size} />;
  }

  // 7. Slack
  if (combined.includes('slack')) {
    return <SlackIcon size={size} />;
  }

  // 8. Notion
  if (combined.includes('notion')) {
    return <NotionIcon size={size} />;
  }

  // 9. Discord
  if (combined.includes('discord')) {
    return <DiscordIcon size={size} />;
  }

  // 10. Supabase
  if (combined.includes('supabase')) {
    return <SupabaseIcon size={size} />;
  }

  // 11. Cloudflare
  if (combined.includes('cloudflare')) {
    return <CloudflareIcon size={size} />;
  }

  // 12. Docker
  if (combined.includes('docker')) {
    return <DockerIcon size={size} />;
  }

  // 13. Kubernetes
  if (combined.includes('kubernetes') || combined.includes('k8s')) {
    return <KubernetesIcon size={size} />;
  }

  // 14. Postgres
  if (
    combined.includes('postgres') ||
    combined.includes('postgresql') ||
    combined.includes('psql')
  ) {
    return <PostgresIcon size={size} />;
  }

  // 15. Redis
  if (combined.includes('redis')) {
    return <RedisIcon size={size} />;
  }

  // 16. MongoDB
  if (combined.includes('mongodb') || combined.includes('mongo')) {
    return <MongoDbIcon size={size} />;
  }

  return null;
}
