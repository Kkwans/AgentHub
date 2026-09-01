import { PromptLibraryView } from '../components/PromptLibraryView';
import { usePromptLibrary } from '../hooks/usePromptLibrary';

export function PromptLibraryPage() {
  const model = usePromptLibrary();
  return <PromptLibraryView model={model} />;
}
