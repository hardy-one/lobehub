import { useLexicalComposerContext } from '@lobehub/editor';
import type { FC } from 'react';
import { useLayoutEffect } from 'react';

import { ContextReference } from './ContextReference';
import { ContextReferencePlugin } from './ContextReferencePlugin';

const ReactContextReferencePlugin: FC = () => {
  const [editor] = useLexicalComposerContext();

  useLayoutEffect(() => {
    editor.registerPlugin(ContextReferencePlugin, {
      decorator: (node, lexicalEditor) => (
        <ContextReference
          editor={lexicalEditor}
          nodeKey={node.getKey()}
          selection={node.selection}
        />
      ),
    });
  }, [editor]);

  return null;
};

ReactContextReferencePlugin.displayName = 'ReactContextReferencePlugin';

export default ReactContextReferencePlugin;
