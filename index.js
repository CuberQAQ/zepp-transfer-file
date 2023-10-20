import {
  MessageBuilder,
  genTraceId,
  MessagePayloadDataTypeOp,
  DataType
} from "./lib/message.js";
import { EventBus } from "@zos/utils";
import "./lib/device-polyfill.js";
import * as fs from "@zos/fs";
import * as hmBle from "@zos/ble";
import * as hmApp from "@zos/app";
import * as path from "@cuberqaq/path-polyfill";
import { log } from "@zos/utils";
const DEBUG = false;
const logger = log.getLogger("@cuber/transfer-file");
var _TransferFileStatue = /* @__PURE__ */ ((_TransferFileStatue2) => {
  _TransferFileStatue2[_TransferFileStatue2["OK"] = 0] = "OK";
  _TransferFileStatue2[_TransferFileStatue2["ERROR"] = 1] = "ERROR";
  return _TransferFileStatue2;
})(_TransferFileStatue || {});
function _parseHmPath(path2) {
  path2 = path2.trim();
  let isAssets;
  if (path2.startsWith("assets://")) {
    path2 = path2.substring("assets://".length);
    isAssets = true;
  } else if (path2.startsWith("data://")) {
    path2 = path2.substring("data://".length);
    isAssets = false;
  } else
    throw new Error("[@cuberqaq/transfer-file] Unexpected arg fileName");
  return {
    path: path2,
    isAssets
  };
}
class TransferFile {
  constructor() {
    let packageInfo = hmApp.getPackageInfo();
    this._receiveQuene = new Array();
    this._sendQuene = new Array();
    this._childInboxList = new Array();
    this._childOutboxList = new Array();
    this._messageBuilder = new MessageBuilder({
      appId: packageInfo.appId ?? 0,
      appDevicePort: 20,
      appSidePort: 0,
      ble: hmBle
    });
    this._messageBuilder.connect(() => {
      logger.warn("Connect Success");
    });
    this._messageBuilder.on(
      "request",
      (req) => {
        let { request, response } = req;
        if (request.contentType === MessagePayloadDataTypeOp.BIN) {
          let filePayloadInfo = TransferFile._parsePayload(request.payload);
          let fileObject = new FileObject({
            sessionId: filePayloadInfo.sessionId,
            fileName: filePayloadInfo.fileName,
            filePath: filePayloadInfo.filePath,
            params: filePayloadInfo.params,
            fileSize: filePayloadInfo.fileSize,
            readyState: "pending"
          });
          for (let inbox of this._childInboxList)
            inbox.emit("NEWFILE");
          let parsed = _parseHmPath(filePayloadInfo.filePath);
          fileObject._changeReadyState("transferring");
          try {
            let fileHandle;
            if (parsed.isAssets)
              fileHandle = fs.openAssetsSync({
                path: parsed.path,
                flag: fs.O_RDWR | fs.O_CREAT
              });
            else
              fileHandle = fs.openSync({
                path: parsed.path,
                flag: fs.O_RDWR | fs.O_CREAT
              });
            let bufView = new Uint8Array(filePayloadInfo.payload);
            DEBUG && logger.warn("File 10 bytes:" + bufView.subarray(0, 10).join(","));
            fs.writeSync({
              fd: fileHandle,
              buffer: filePayloadInfo.payload
            });
            this._receiveQuene.push(fileObject);
            fileObject._changeReadyState("transferred");
            for (let inbox of this._childInboxList)
              inbox.emit("FILE");
            response({
              data: {
                statue: 0 /* OK */
              }
            });
          } catch (e) {
            fileObject._changeReadyState("error");
            response({
              data: {
                statue: 1 /* ERROR */
              }
            });
          }
        }
      }
    );
  }
  trySendFile() {
    for (let fileObject of this._sendQuene) {
      if (fileObject.readyState === "pending") {
        try {
          DEBUG && logger.log("Start Load File");
          let { path: filePath, isAssets } = _parseHmPath(fileObject.filePath);
          let fileHandle;
          let buf = new ArrayBuffer(fileObject.fileSize);
          if (isAssets)
            fileHandle = fs.openAssetsSync({
              path: filePath,
              flag: fs.O_RDONLY
            });
          else
            fileHandle = fs.openSync({ path: filePath, flag: fs.O_RDONLY });
          fs.readSync({
            fd: fileHandle,
            buffer: buf
          });
          fileObject._changeReadyState("transferring");
          DEBUG && logger.log("Start Send File");
          this._messageBuilder.request(
            TransferFile._buildPayload({
              sessionId: fileObject.sessionId,
              fileName: fileObject.fileName,
              filePath: fileObject.filePath,
              fileSize: fileObject.fileSize,
              params: fileObject.params,
              payload: buf
            }),
            {
              contentType: DataType.bin,
              dataType: DataType.json
            }
          ).then((res) => {
            try {
              let statue = res?.statue;
              if (statue === 0 /* OK */) {
                fileObject._changeReadyState("transferred");
              } else {
                fileObject._changeReadyState("error");
              }
              DEBUG && logger.log("Send File Responsed");
            } catch (e) {
              logger.error(e);
              throw e;
            }
          }).catch((e) => {
          });
          DEBUG && logger.warn("Send File Done");
        } catch (e) {
          fileObject._changeReadyState("error");
          if (typeof e === "string")
            logger.error(e);
          throw e;
        }
      }
    }
  }
  static _parsePayload(buffer) {
    let offset = 0;
    const sessionId = buffer.readInt32LE(offset);
    offset += 4;
    const fileSize = buffer.readUInt32LE(offset);
    offset += 4;
    const fileNameLength = buffer.readUInt32LE(offset);
    offset += 4;
    const filePathLength = buffer.readUInt32LE(offset);
    offset += 4;
    const paramsStrLength = buffer.readUInt32LE(offset);
    offset += 4;
    const fileName = buffer.toString(
      "utf16le",
      offset,
      offset + fileNameLength
    );
    offset += fileNameLength;
    const filePath = buffer.toString(
      "utf16le",
      offset,
      offset + filePathLength
    );
    offset += filePathLength;
    const params = JSON.stringify(
      buffer.toString("utf16le", offset, offset + paramsStrLength)
    );
    offset += paramsStrLength;
    const payloadLength = buffer.byteLength - offset;
    let payloadBuf = new ArrayBuffer(payloadLength);
    let payloadBufView = Buffer.from(payloadBuf);
    buffer.copy(payloadBufView, 0, offset);
    return {
      sessionId,
      fileName,
      filePath,
      params,
      fileSize,
      payload: payloadBuf
    };
  }
  static _buildPayload(info) {
    const staticHeadLength = 20;
    const fileNameLength = info.fileName.length * 2;
    const filePathLength = info.filePath.length * 2;
    const paramsStr = JSON.stringify(info.params);
    const paramsStrLength = typeof paramsStr === "undefined" ? 0 : paramsStr.length;
    const totalHeadLength = staticHeadLength + fileNameLength + filePathLength + paramsStrLength;
    const payloadLength = info.payload.byteLength;
    let buf = new ArrayBuffer(totalHeadLength + payloadLength);
    let buffer = Buffer.from(buf);
    let payloadBuffer = Buffer.from(info.payload);
    let offset = 0;
    buffer.writeInt32LE(info.sessionId, offset);
    offset += 4;
    buffer.writeUInt32LE(info.fileSize, offset);
    offset += 4;
    buffer.writeUInt32LE(fileNameLength, offset);
    offset += 4;
    buffer.writeUInt32LE(filePathLength, offset);
    offset += 4;
    buffer.writeUInt32LE(paramsStrLength, offset);
    offset += 4;
    buffer.write(info.fileName, offset, "utf16le");
    offset += fileNameLength;
    buffer.write(info.filePath, offset, "utf16le");
    offset += filePathLength;
    if (typeof paramsStr !== "undefined") {
      buffer.write(paramsStr, offset, "utf16le");
      offset += paramsStrLength;
    }
    payloadBuffer.copy(buffer, offset);
    return buffer;
  }
  /**
   * Get the receiving file object. 获取接收文件对象
   * @returns Receiving file object. 接收文件对象
   */
  getInbox() {
    let newInbox = new Inbox(this);
    this._childInboxList.push(newInbox);
    return newInbox;
  }
  /**
   * Get the sending file object 获取发送文件对象
   * @returns Sending file object 发送文件对象
   */
  getOutbox() {
    let newOutbox = new Outbox(this);
    this._childOutboxList.push(newOutbox);
    return newOutbox;
  }
}
class Inbox extends EventBus {
  constructor(_parent) {
    super();
    this._parent = _parent;
  }
  /**
   * Get a FileObject to receive the file object. 获取`FileObject`接收文件对象
   * @returns FileObject to receive the file object. `FileObject`接收文件对象
   */
  getNextFile() {
    return this._parent._receiveQuene.shift();
  }
  /**
   * Listening event, event name reference `InboxEventName`. 添加监听事件，事件名称参考 InboxEventName.
   * @param eventName Event name. 监听事件.
   * @param callback Callback function. 回调函数.
   */
  on(eventName, callback) {
    super.on(eventName, callback);
  }
}
class Outbox {
  constructor(_parent) {
    this._parent = _parent;
  }
  /**
   * Enquene a file to sending quene. 添加文件至发送队列
   * @param fileName The path to the file.
   * @param params A customized file transfer object, retrieved from FileObject on the receiving end.
   * @returns Returns a `FileObject`. 返回`FileObject`文件发送对象
   */
  enqueneFile(fileName, params) {
    let parsed = _parseHmPath(fileName);
    fileName = parsed.path;
    let isAssets = parsed.isAssets;
    let fileStatue = isAssets ? fs.statAssetsSync({ path: fileName }) : fs.statSync({ path: fileName });
    if (typeof fileStatue === "undefined")
      throw new Error("[@cuberqaq/transfer-file] File Not Exist");
    let fileObject = new FileObject({
      sessionId: genTraceId(),
      fileName: path.parse(fileName).base,
      filePath: (isAssets ? "assets://" : "data://") + fileName,
      params,
      fileSize: fileStatue.size,
      readyState: "pending"
    });
    DEBUG && logger.warn(
      "Pending to Send File: " + JSON.stringify({
        fileName: fileObject.fileName,
        filePath: fileObject.filePath,
        fileSize: fileObject.fileSize,
        sessionId: fileObject.sessionId
      })
    );
    this._parent._sendQuene.push(fileObject);
    this._parent.trySendFile();
    return fileObject;
  }
}
class FileObject extends EventBus {
  constructor({
    sessionId,
    fileName,
    filePath,
    params,
    fileSize,
    readyState
  }) {
    super();
    this.sessionId = sessionId;
    this.fileName = fileName;
    this.filePath = filePath;
    this.params = params;
    this.fileSize = fileSize;
    this.readyState = readyState;
  }
  _changeReadyState(newState) {
    this.readyState = newState;
    let event = {
      type: "readyStateChanged",
      data: {
        readyState: newState
      },
      timestamp: (/* @__PURE__ */ new Date()).getTime()
    };
    this.emit("change", event);
  }
  /**
   * @description Cancel a file transfer task. 取消传输文件任务
   */
  cancel() {
  }
  /**
   * @description Listen to the file transfer task event, event name reference FileEventName. 监听文件传输任务事件，事件名参考 FileEventName
   * @param eventName
   * @param callback
   */
  on(eventName, callback) {
    super.on(eventName, callback);
  }
}
export {
  TransferFile,
  _parseHmPath
};
