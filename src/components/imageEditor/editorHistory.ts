/**
 * 图片编辑器：整文档快照（用于撤销 / 重做）
 */
import type { EditorObject } from './editorTypes';

export type EditorDocSnapshot = {
  docWidth: number;
  docHeight: number;
  docBackgroundColor: string;
  objects: EditorObject[];
};

export function cloneEditorObject(o: EditorObject): EditorObject {
  if (o.type === 'image') {
    return {
      ...o,
      sourceCrop: o.sourceCrop ? { ...o.sourceCrop } : undefined,
    };
  }
  return { ...o };
}

export function cloneDocSnapshot(s: EditorDocSnapshot): EditorDocSnapshot {
  return {
    docWidth: s.docWidth,
    docHeight: s.docHeight,
    docBackgroundColor: s.docBackgroundColor,
    objects: s.objects.map(cloneEditorObject),
  };
}
