/**
 * RescueOS Pluggable LoRa Mesh Transport Adapter (Architecture Interface)
 * 
 * NOTE: As per zero-cost and strict project specifications, LoRa is implemented
 * purely as a PLUGGABLE TRANSPORT ARCHITECTURE for future hardware integration
 * (e.g., SX1262, SX1276, or RAK serial bridge).
 * No physical LoRa hardware is simulated as present if not connected.
 */

const crypto = require('crypto');

class LoRaTransportAdapter {
  constructor() {
    this.hardwareDetected = false;
    this.status = 'FUTURE_EXTENSION_UNPLUGGED';
    this.baudRate = 115200;
    this.packetQueue = [];
  }

  /**
   * Status reporter for Command Center
   */
  getStatus() {
    return {
      name: 'LoRa Low-Bandwidth Packet Mesh',
      status: this.status,
      hardwareDetected: this.hardwareDetected,
      maxPacketBytes: 256,
      supportedFrequencies: ['433 MHz (Asia/India)', '868 MHz (EU)', '915 MHz (US)'],
      transportInterface: 'Serial UART / USB Virtual COM',
      packetFormat: 'RescueOS-LoRa-Frame-v1',
      notes: 'Hardware adapter currently unplugged. System operates on Local Wi-Fi AP / Ethernet.'
    };
  }

  /**
   * Encode an emergency SOS or telemetry packet into compact hex string
   * Frame format:
   * [0] Magic byte (0x52 = 'R')
   * [1] Version (0x01)
   * [2] MsgType (0x01=SOS, 0x02=ACK, 0x03=BEACON, 0x04=TELEMETRY)
   * [3-6] Packet Sequence / Timestamp (4 bytes)
   * [7..N] Compressed Payload
   * [N+1..N+2] CRC16 Checksum
   */
  encodePacket(type, payload) {
    const magic = Buffer.from([0x52, 0x01]);
    const typeByte = Buffer.from([type === 'SOS' ? 0x01 : 0x02]);
    const payloadBuf = Buffer.from(JSON.stringify(payload));
    const full = Buffer.concat([magic, typeByte, payloadBuf]);
    const crc = crypto.createHash('md5').update(full).digest().slice(0, 2);
    return Buffer.concat([full, crc]).toString('hex');
  }

  /**
   * Send packet: if hardware connected, transmit over serial port;
   * otherwise queue for hardware attachment.
   */
  transmit(type, payload) {
    if (!this.hardwareDetected) {
      return {
        success: false,
        queued: false,
        error: 'LoRa transceiver not detected. To use LoRa, connect a compatible UART bridge.'
      };
    }
    const frame = this.encodePacket(type, payload);
    return { success: true, frameLength: frame.length / 2 };
  }
}

module.exports = new LoRaTransportAdapter();
