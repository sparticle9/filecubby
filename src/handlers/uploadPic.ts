import { Context } from 'hono'
import { Env } from '../index'
import { getUser } from '../db'
import { determineFileType } from '../utils/fileUtils'
import { handleFileUpload } from '../utils/uploadUtils'

export async function uploadPic(c: Context<{ Bindings: Env }>) {
  try {
    const token = c.req.query('token');
    if (!token) {
      console.log('uploadPic: Token is missing');
      return c.json({ Code: 0, Message: 'Token is required' }, 400);
    }

    const user = await getUser(c.env.USERS, token);
    if (!user) {
      console.log('uploadPic: Invalid token');
      return c.json({ Code: 0, Message: 'Invalid token' }, 401);
    }

    console.log(`uploadPic: User authenticated - ${user.id}`);

    const formData = await c.req.formData();
    const file = formData.get('image') as File | null;
    if (!file) {
      console.log('uploadPic: No file uploaded');
      return c.json({ Code: 0, Message: 'No file uploaded' }, 400);
    }

    const fileType = await determineFileType(file);
    console.log(`uploadPic: File type determined - ${fileType}`);

    const maxSize = parseInt(c.env.PIC_MAX_SIZE, 10);

    return handleFileUpload(c, user, file, fileType, null, maxSize);
  } catch (error) {
    console.error('Error in uploadPic:', error);
    return c.json({ Code: 0, Message: `Failed to upload picture: ${error.message}` }, 500);
  }
}
