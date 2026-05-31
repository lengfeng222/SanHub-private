export type PublicMediaUpload = {
  name: string;
  mimeType: string;
  url: string;
  size: number;
};

type UploadApiResponse = {
  success?: boolean;
  data?: PublicMediaUpload;
  error?: string;
};

export async function uploadMediaFileToPublicUrl(file: File): Promise<PublicMediaUpload> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch('/api/upload/media', {
    method: 'POST',
    body: formData,
    credentials: 'include',
  });

  const payload = (await res.json().catch(() => ({}))) as UploadApiResponse;
  if (!res.ok || !payload.success || !payload.data?.url) {
    throw new Error(payload.error || '素材上传失败');
  }

  return payload.data;
}
