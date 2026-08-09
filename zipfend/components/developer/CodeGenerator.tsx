import React, { useState } from 'react';

interface CodeGeneratorProps {
  apiKey: string;
  endpointUrl: string;
  payload: any;
}

export const CodeGenerator: React.FC<CodeGeneratorProps> = ({
  apiKey,
  endpointUrl,
  payload,
}) => {
  const [lang, setLang] = useState<'curl' | 'python' | 'javascript' | 'node'>('curl');
  const [copied, setCopied] = useState(false);

  const cleanApiKey = apiKey.trim() || 'zr_test_YOUR_API_KEY';

  const generateCurl = () => {
    return `curl -X POST "${endpointUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${cleanApiKey}" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
  };

  const generatePython = () => {
    return `import requests

url = "${endpointUrl}"
headers = {
    "Content-Type": "application/json",
    "X-API-Key": "${cleanApiKey}"
}
payload = ${JSON.stringify(payload, null, 4)}

response = requests.post(url, json=payload, headers=headers)
print("Status:", response.status_code)
print("Response:", response.json())`;
  };

  const generateJavaScript = () => {
    return `const response = await fetch("${endpointUrl}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-API-Key": "${cleanApiKey}"
  },
  body: JSON.stringify(${JSON.stringify(payload, null, 2)})
});

const data = await response.json();
console.log("Status:", response.status);
console.log("Data:", data);`;
  };

  const generateNode = () => {
    return `const axios = require('axios');

const response = await axios.post("${endpointUrl}", ${JSON.stringify(payload, null, 2)}, {
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${cleanApiKey}'
  }
});

console.log(response.data);`;
  };

  const getCodeSnippet = () => {
    switch (lang) {
      case 'curl':
        return generateCurl();
      case 'python':
        return generatePython();
      case 'javascript':
        return generateJavaScript();
      case 'node':
        return generateNode();
      default:
        return generateCurl();
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getCodeSnippet());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface-1 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between bg-surface-2 border-b border-line px-4 py-2.5">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {(
            [
              { id: 'curl', label: 'cURL' },
              { id: 'python', label: 'Python' },
              { id: 'javascript', label: 'JS (Fetch)' },
              { id: 'node', label: 'Node (Axios)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setLang(t.id)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
                lang === t.id
                  ? 'bg-brand text-on-brand'
                  : 'text-ink-soft hover:text-ink hover:bg-surface-0'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface-0 text-[12px] font-medium text-ink hover:border-brand transition-colors shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">
            {copied ? 'check' : 'content_copy'}
          </span>
          <span>{copied ? 'Copied!' : 'Copy Code'}</span>
        </button>
      </div>

      <div className="p-4 bg-ink/90 text-white font-mono text-[12px] leading-relaxed overflow-x-auto no-scrollbar">
        <pre>{getCodeSnippet()}</pre>
      </div>
    </div>
  );
};
