import type { RuntimeToolDescriptor } from '../../../lib/runtimeApi/toolDescriptors.ts'
import type { FilePreviewKind } from '../../../types/index.ts'

export interface ResolvePreviewPluginWorkbenchToolParams {
  tool: RuntimeToolDescriptor
  previewKind: FilePreviewKind
}

const FACE_DETECT_AND_CLUSTER_ACTION = {
  key: 'detectAssetRunCluster',
  label: '检测并识别人脸',
  intent: 'primary',
  arguments: {
    operation: 'detectAsset',
    runCluster: true,
  },
}

export function resolvePreviewPluginWorkbenchTool({
  tool,
  previewKind,
}: ResolvePreviewPluginWorkbenchToolParams): RuntimeToolDescriptor {
  if (tool.name === 'local.data') {
    return {
      ...tool,
      toolActions: tool.toolActions.filter((action) => action.arguments?.operation !== 'ensureFileEntries'),
    }
  }

  if (tool.name === 'vision.face' && (previewKind === 'image' || previewKind === 'video')) {
    return {
      ...tool,
      toolActions: [
        {
          ...FACE_DETECT_AND_CLUSTER_ACTION,
          description: previewKind === 'video'
            ? '对当前视频抽帧检测并立即执行人物归属'
            : '对当前图片执行检测并立即执行人物归属',
        },
        ...tool.toolActions,
      ],
    }
  }

  return tool
}
