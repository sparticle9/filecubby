import os
import json
import time
import redis
import psycopg2
from dotenv import load_dotenv
import telegram

# Load environment variables
load_dotenv()

# Initialize Redis client
redis_client = redis.Redis(
    host=os.getenv('REDIS_HOST'),
    port=int(os.getenv('REDIS_PORT')),
    password=os.getenv('REDIS_PASSWORD'),
    ssl=True
)

# Initialize PostgreSQL connection
db_conn = psycopg2.connect(os.getenv('AIVEN_PG_URL'))

# Initialize Telegram bot
bot = telegram.Bot(token=os.getenv('BOT_TOKEN'))

def delete_file(file_id):
    try:
        # Retrieve file metadata from PostgreSQL
        with db_conn.cursor() as cur:
            cur.execute("SELECT * FROM file_metadata WHERE file_id = %s", (file_id,))
            metadata = cur.fetchone()

        if metadata is None:
            return False

        _, _, _, is_chunked, _, chunk_urls, _, _ = metadata

        if is_chunked:
            # Delete all chunk messages
            for chunk_id in json.loads(chunk_urls):
                bot.delete_message(chat_id=os.getenv('CHANNEL_ID'), message_id=int(chunk_id))

        # Delete the main file or manifest message
        bot.delete_message(chat_id=os.getenv('CHANNEL_ID'), message_id=int(file_id))

        # Remove from Redis
        redis_client.zrem('expiring_files', file_id)

        # Delete metadata from PostgreSQL
        with db_conn.cursor() as cur:
            cur.execute("DELETE FROM file_metadata WHERE file_id = %s", (file_id,))
        db_conn.commit()

        return True
    except Exception as e:
        print(f"Error deleting file: {str(e)}")
        return False

def lambda_handler(event, context):
    now = int(time.time())
    expired_files = redis_client.zrangebyscore('expiring_files', 0, now)

    for file_id in expired_files:
        success = delete_file(file_id.decode('utf-8'))
        if success:
            print(f"Successfully deleted file {file_id}")
        else:
            print(f"Failed to delete file {file_id}")

    return {
        'statusCode': 200,
        'body': json.dumps('Expired files deletion process completed')
    }

if __name__ == "__main__":
    # For local testing
    lambda_handler(None, None)