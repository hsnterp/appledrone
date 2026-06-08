import socket
import time

# Use the exact method the official app uses
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('', 8889))

# Send command
msg = 'command'
tello_address = ('192.168.10.1', 8889)

print("Attempting connection like official app...")

for i in range(3):
    print(f"Attempt {i+1}/3...")
    sock.sendto(msg.encode('utf-8'), tello_address)
    
    sock.settimeout(3)
    try:
        response, ip = sock.recvfrom(1024)
        print(f"✓ SUCCESS! Response: {response.decode('utf-8')}")
        break
    except socket.timeout:
        print("  No response, retrying...")
        time.sleep(1)
else:
    print("✗ All attempts failed")

sock.close()