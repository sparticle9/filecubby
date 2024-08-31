import os
import json
import httpx
import mimetypes
from pathlib import Path
from tqdm import tqdm
from dotenv import load_dotenv
import asyncio
import ssl
import certifi
import socket
import uuid

load_dotenv()

def get_env(key):
    value = os.getenv(key)
    if not value:
        raise ValueError(f"{key} is not set in the environment variables")
    return value

async def init_upload(client, api_url, headers, file_path, chunk_size, expiry_hours):
    file_size = Path(file_path).stat().st_size
    total_chunks = (file_size + chunk_size - 1) // chunk_size
    mime_type, _ = mimetypes.guess_type(file_path)
    if not mime_type:
        mime_type = 'application/octet-stream'

    data = {
        'isInit': 'true',
        'fileName': Path(file_path).name,
        'fileSize': str(file_size),
        'fileType': mime_type,
        'totalChunks': str(total_chunks),
        'chunkSize': str(chunk_size),
        'expiryHours': str(expiry_hours) if expiry_hours else None
    }

    print("Initializing upload with the following metadata:")
    print(json.dumps(data, indent=2))

    response = await client.post(api_url, headers=headers, data=data)
    result = response.json()
    print("Server response:", json.dumps(result, indent=2))

    if result.get('Code') != 1:
        raise Exception(f"Failed to initialize upload: {result.get('Message')}")
    return result['fileId'], result['sessionId'], total_chunks

async def upload_chunk(client, api_url, headers, file_path, chunk_number, chunk_size, start_byte, file_size, session_id, file_id, total_chunks):
    with open(file_path, 'rb') as f:
        f.seek(start_byte)
        chunk = f.read(chunk_size)
    
    files = {'file': (f'{Path(file_path).name}.part{chunk_number}', chunk)}
    data = {
        'isChunk': 'true',
        'chunkIndex': str(chunk_number),
        'totalChunks': str(total_chunks),
        'sessionId': session_id,
        'fileId': file_id  # Add this line
    }
    
    try:
        response = await client.post(api_url, headers=headers, files=files, data=data)
        print("request data: ", data)
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as e:
        print(f"HTTP error occurred: {e.response.status_code} {e.response.reason_phrase}")
        print(f"Response content: {e.response.text}")
        raise
    except Exception as e:
        print(f"An unexpected error occurred: {str(e)}")
        raise

async def upload_file(file_path, expiry_hours, token, chunk_size=19*1024*1024, max_retries=3):
    api_url = get_env('API_URL')
    file_size = Path(file_path).stat().st_size
    file_name = Path(file_path).name

    headers = {
        "Authorization": f"Bearer {token}"
    }

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    
    print(f"Attempting to upload to {api_url}")
    print(f"File size: {file_size} bytes")
    print(f"Chunk size: {chunk_size} bytes")

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout=None), verify=ssl_context) as client:
        if file_size <= chunk_size:
            # Single file upload
            with open(file_path, 'rb') as f:
                files = {'file': (Path(file_path).name, f)}
                data = {'expiryHours': str(expiry_hours)} if expiry_hours else {}
                
                with tqdm(total=file_size, unit='B', unit_scale=True, desc=f"Uploading {Path(file_path).name}") as pbar:
                    response = await client.post(api_url, headers=headers, files=files, data=data)
                    pbar.update(file_size)

            result = response.json()
            if result.get('Code') == 1:
                print(f"File uploaded successfully. URL: {result.get('url')}")
                return result.get('url')
            else:
                print(f"Error uploading file: {result.get('Message')}")
                return None
        else:
            # Chunked upload
            file_id, session_id, total_chunks = await init_upload(client, api_url, headers, file_path, chunk_size, expiry_hours)
            
            with tqdm(total=total_chunks, unit='chunk', desc=f"Uploading {file_name}") as pbar:
                for chunk_number in range(total_chunks):
                    start_byte = chunk_number * chunk_size
                    end_byte = min(start_byte + chunk_size, file_size)
                    chunk_size = end_byte - start_byte
                    
                    for attempt in range(max_retries):
                        try:
                            result = await upload_chunk(client, api_url, headers, file_path, chunk_number, chunk_size, start_byte, file_size, session_id, file_id, total_chunks)
                            if result.get('Code') == 1:
                                pbar.update(1)
                                if 'url' in result:
                                    print(f"Upload completed. Download URL: {result['url']}")
                                    return result['url']
                                break
                            else:
                                print(f"Error uploading chunk {chunk_number + 1}: {result.get('Message')}")
                                if attempt < max_retries - 1:
                                    print(f"Retrying chunk {chunk_number + 1} in 5 seconds...")
                                    await asyncio.sleep(5)
                                else:
                                    print(f"Max retries reached for chunk {chunk_number + 1}. Upload failed.")
                                    return None
                        except Exception as e:
                            print(f"Error uploading chunk {chunk_number + 1} (attempt {attempt + 1}): {e}")
                            if attempt < max_retries - 1:
                                print(f"Retrying chunk {chunk_number + 1} in 5 seconds...")
                                await asyncio.sleep(5)
                            else:
                                print(f"Max retries reached for chunk {chunk_number + 1}. Upload failed.")
                                return None
            
            print("All chunks uploaded successfully.")
            return f"{api_url}/d/{file_id}"  # Construct the download URL

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Upload a file to the server")
    parser.add_argument("file_path", help="Path to the file to upload")
    parser.add_argument("--expiry", type=int, help="Expiry time in hours")
    parser.add_argument("--token", help="Authentication token")
    args = parser.parse_args()

    token = args.token or get_env('AUTH_TOKEN')
    result = await upload_file(args.file_path, args.expiry, token)
    if result:
        print(f"Download URL: {result}")
    else:
        print("Upload failed.")

if __name__ == "__main__":
    asyncio.run(main())