export function ProviderWarning({ live }: { live: boolean }) {
  return <aside className="privacy-note">{live
    ? 'Live: your source and style samples go to the configured model provider and are stored in your anonymous account. Clearing browser storage or losing this session can make your history inaccessible.'
    : 'Offline Demo uses bundled, authored scripts and browser storage. It does not generate responses to arbitrary input. Local demo records are not server-enforced rulings.'}</aside>;
}
