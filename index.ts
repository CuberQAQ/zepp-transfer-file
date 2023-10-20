/// <reference path = "node_modules/@zeppos/device-types/dist/index.d.ts" />
import {
  MessageBuilder,
  genTraceId,
  MessagePayloadDataTypeOp,
  DataType,
} from "./lib/message.js";
import { EventBus } from "@zos/utils";
import "./lib/device-polyfill.js"; // fk. If not import, the simulator&watch will freeze with no log output when using Promise. I had been debug for a few hours to find this problem. FK!
import * as fs from "@zos/fs";
import * as hmBle from "@zos/ble";
import * as hmApp from "@zos/app";
import * as path from "@cuberqaq/path-polyfill";
import { log } from "@zos/utils";
const DEBUG = false;
const logger = log.getLogger("@cuber/transfer-file");
declare type InboxEventName =
  | "NEWFILE" /** The event that just received the file. 刚接收到文件的事件 */
  | "FILE"; /** The event that completed receiving the file. 完成接收文件的事件	 */
declare type ReceiveFileState =
  | "pending" /** 等待 */
  | "transferring" /** 传输中 */
  | "transferred" /** 	传输完成	 */
  | "error" /** 错误 */
  | "canceled"; /** 取消 */
declare type FileEventName =
  | "change" /** The event name that occurs when `readyState` changes state, corresponding to the `ChangeCallback` callback function. 当`readyState`转变状态时候发生的事件名，对应`ChangeCallback`回调函数 */
  | "progress"; /** The event name when the file transfer progress changes, corresponding to the `ProgressCallback` callback function 文件传输进度发生变化时的事件，对应`ProgressCallback`回调函数 */
declare type ChangeEventData = {
  readyState: ReceiveFileState | string; // TODO 官方文档为string
};
declare interface ProgressEventData {
  /**
   * @prop File size in bytes. 文件大小，单位字节
   */
  fileSize: number;
  /**
   * @prop The size of the transferred file in bytes. 已经传输的文件大小，单位字节
   */
  loadedSize: number;
}
/**
 * @interface ChangeEvent Event info when `readyState` changes state. `readyState`状态改变时触发的事件的信息
 */
declare interface ChangeEvent {
  /**
   * @prop Event type, value is "readyStateChanged" string. 事件类型，值为 "readyStateChanged" 字符串
   */
  type: "readyStateChanged";
  /**
   * @prop Event data object. 事件数据对象，类型见`ChangeEventData`
   * @see ChangeEventData for type
   * @todo 官方文档为date
   */
  data: ChangeEventData; // TODO 官方文档为date
  /**
   * @prop UTC timestamp of the event, in milliseconds. 事件发生时的 UTC 时间戳，单位毫秒
   */
  timestamp: number;
}
/**
 * @interface ProgressEvent Event info when file transfer progress changes. 文件传输进度改变时触发的事件的信息
 */
declare interface ProgressEvent {
  /**
   * @prop Event type, value is "progress" string. 事件类型，值为"progress"字符串
   */
  type: "progress";
  /**
   * @prop Event data object. 事件数据对象，类型见`ProgressEventData`
   * @see ProgressEventData for type
   * @todo 官方文档为date
   */
  data: ProgressEventData; // TODO 官方文档为date
  /**
   * @prop UTC timestamp at the time of the event. 事件发生时的 UTC 时间戳，单位毫秒
   */
  timestamp: number;
}
/**
 * @description The callback that occurs when `readyState` changes state. 当`readyState`转变状态时候发生的事件回调函数
 */
declare type ChangeCallback = (event: ChangeEvent) => void;
/**
 * @description Event callback function when file transfer progress changes. 当文件传输进度变化时的事件回调函数
 */
declare type ProgressCallback = (event: ProgressEvent) => void;

enum _TransferFileStatue {
  OK,
  ERROR,
}

type _MessageFullPayloadType = {
  traceId: number;
  parentId: 0;
  spanId: number;
  seqId: number;
  totalLength: number;
  payloadLength: number;
  payloadType: number;
  opCode: number;
  contentType: number;
  dataType: number;
  timestamp1: number;
  timestamp2: 0;
  timestamp3: 0;
  timestamp4: 0;
  timestamp5: 0;
  timestamp6: 0;
  timestamp7: 0;
  extra1: 0;
  extra2: 0;
  extra3: 0;
  payload: Buffer;
};
type _MessageResponseType = {
  requestId?: number;
  contentType?: number;
  dataType?: number;
  data: Buffer | ArrayBuffer | ArrayBufferView | Object;
};
type _FilePayloadInfo = {
  sessionId: number;
  fileName: string;
  filePath: string;
  params: any;
  fileSize: number;
  payload: ArrayBuffer;
};

export function _parseHmPath(path: string) {
  path = path.trim();
  let isAssets: boolean;
  if (path.startsWith("assets://")) {
    path = path.substring("assets://".length);
    isAssets = true;
  } else if (path.startsWith("data://")) {
    path = path.substring("data://".length);
    isAssets = false;
  } else throw new Error("[@cuberqaq/transfer-file] Unexpected arg fileName");
  return {
    path,
    isAssets,
  };
}

/**
 * @class
 * Transfer File 文件传输
 */
export class TransferFile {
  _messageBuilder: MessageBuilder;
  _receiveQuene: Array<FileObject>;
  _sendQuene: Array<FileObject>;
  _childInboxList: Array<Inbox>;
  _childOutboxList: Array<Outbox>;
  constructor() {
    let packageInfo: any = hmApp.getPackageInfo();
    this._receiveQuene = new Array<FileObject>();
    this._sendQuene = new Array<FileObject>();
    this._childInboxList = new Array<Inbox>();
    this._childOutboxList = new Array<Outbox>();
    this._messageBuilder = new MessageBuilder({
      appId: packageInfo.appId ?? 0,
      appDevicePort: 20,
      appSidePort: 0,
      ble: hmBle,
    });
    this._messageBuilder.connect(() => {
      logger.warn("Connect Success");
    });

    // 接收文件
    this._messageBuilder.on(
      "request",
      (req: {
        request: _MessageFullPayloadType;
        response: (res: _MessageResponseType) => void;
      }) => {
        let { request, response } = req;
        if (request.contentType === MessagePayloadDataTypeOp.BIN) {
          let filePayloadInfo = TransferFile._parsePayload(request.payload);
          let fileObject = new FileObject({
            sessionId: filePayloadInfo.sessionId,
            fileName: filePayloadInfo.fileName,
            filePath: filePayloadInfo.filePath,
            params: filePayloadInfo.params,
            fileSize: filePayloadInfo.fileSize,
            readyState: "pending",
          });
          for (let inbox of this._childInboxList) inbox.emit("NEWFILE");
          let parsed = _parseHmPath(filePayloadInfo.filePath);
          fileObject._changeReadyState("transferring");
          try {
            let fileHandle: number;
            if (parsed.isAssets)
              fileHandle = fs.openAssetsSync({
                path: parsed.path,
                flag: fs.O_RDWR | fs.O_CREAT,
              });
            else
              fileHandle = fs.openSync({
                path: parsed.path,
                flag: fs.O_RDWR | fs.O_CREAT,
              });
            let bufView = new Uint8Array(filePayloadInfo.payload);
            DEBUG &&
              logger.warn("File 10 bytes:" + bufView.subarray(0, 10).join(","));
            fs.writeSync({
              fd: fileHandle,
              buffer: filePayloadInfo.payload,
            });
            this._receiveQuene.push(fileObject);
            fileObject._changeReadyState("transferred");
            for (let inbox of this._childInboxList) inbox.emit("FILE");
            response({
              data: {
                statue: _TransferFileStatue.OK,
              },
            });
          } catch (e) {
            fileObject._changeReadyState("error");
            response({
              data: {
                statue: _TransferFileStatue.ERROR,
              },
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
          // 将文件读入缓存
          let { path: filePath, isAssets } = _parseHmPath(fileObject.filePath);
          let fileHandle: number;
          let buf = new ArrayBuffer(fileObject.fileSize);
          if (isAssets)
            fileHandle = fs.openAssetsSync({
              path: filePath,
              flag: fs.O_RDONLY,
            });
          else fileHandle = fs.openSync({ path: filePath, flag: fs.O_RDONLY });

          fs.readSync({
            fd: fileHandle,
            buffer: buf,
          });

          fileObject._changeReadyState("transferring");
          DEBUG && logger.log("Start Send File");
          // 发送文件
          this._messageBuilder
            .request(
              TransferFile._buildPayload({
                sessionId: fileObject.sessionId,
                fileName: fileObject.fileName,
                filePath: fileObject.filePath,
                fileSize: fileObject.fileSize,
                params: fileObject.params,
                payload: buf,
              }),
              {
                contentType: DataType.bin,
                dataType: DataType.json,
              }
            )
            .then((res) => {
              try {
                let statue = res?.statue;
                if (statue === _TransferFileStatue.OK) {
                  fileObject._changeReadyState("transferred");
                } else {
                  fileObject._changeReadyState("error");
                }
                DEBUG && logger.log("Send File Responsed");
              } catch (e: any) {
                logger.error(e);
                throw e;
              }
            })
            .catch((e) => {});
          DEBUG && logger.warn("Send File Done");
        } catch (e) {
          fileObject._changeReadyState("error");
          if (typeof e === "string") logger.error(e);
          throw e;
        }
      }
    }
  }

  static _parsePayload(buffer: Buffer): _FilePayloadInfo {
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
      payload: payloadBuf,
    };
  }

  static _buildPayload(info: _FilePayloadInfo): Buffer {
    const staticHeadLength = 20;
    const fileNameLength = info.fileName.length * 2;
    const filePathLength = info.filePath.length * 2;
    const paramsStr = JSON.stringify(info.params);
    const paramsStrLength =
      typeof paramsStr === "undefined" ? 0 : paramsStr.length;
    const totalHeadLength =
      staticHeadLength + fileNameLength + filePathLength + paramsStrLength;
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
  getInbox(): Inbox {
    let newInbox = new Inbox(this);
    this._childInboxList.push(newInbox);
    return newInbox;
  }
  /**
   * Get the sending file object 获取发送文件对象
   * @returns Sending file object 发送文件对象
   */
  getOutbox(): Outbox {
    let newOutbox = new Outbox(this);
    this._childOutboxList.push(newOutbox);
    return newOutbox;
  }
}

/**
 * Receiving file object. 接收文件对象
 */
class Inbox extends EventBus {
  _parent: TransferFile;

  constructor(_parent: TransferFile) {
    super();
    this._parent = _parent;
  }
  /**
   * Get a FileObject to receive the file object. 获取`FileObject`接收文件对象
   * @returns FileObject to receive the file object. `FileObject`接收文件对象
   */
  getNextFile(): FileObject | undefined {
    return this._parent._receiveQuene.shift();
  }
  /**
   * Listening event, event name reference `InboxEventName`. 添加监听事件，事件名称参考 InboxEventName.
   * @param eventName Event name. 监听事件.
   * @param callback Callback function. 回调函数.
   */
  on(eventName: InboxEventName, callback: () => void): void {
    super.on(eventName, callback);
  }
}

/**
 * Sending file object. 发送文件对象.
 */
class Outbox {
  _parent: TransferFile;

  constructor(_parent: TransferFile) {
    this._parent = _parent;
  }
  /**
   * Enquene a file to sending quene. 添加文件至发送队列
   * @param fileName The path to the file.
   * @param params A customized file transfer object, retrieved from FileObject on the receiving end.
   * @returns Returns a `FileObject`. 返回`FileObject`文件发送对象
   */
  enqueneFile(fileName: string, params?: object): FileObject {
    let parsed = _parseHmPath(fileName);
    fileName = parsed.path;
    let isAssets = parsed.isAssets;
    let fileStatue = isAssets
      ? fs.statAssetsSync({ path: fileName })
      : fs.statSync({ path: fileName });
    if (typeof fileStatue === "undefined")
      throw new Error("[@cuberqaq/transfer-file] File Not Exist");

    let fileObject = new FileObject({
      sessionId: genTraceId(),
      fileName: path.parse(fileName).base,
      filePath: (isAssets ? "assets://" : "data://") + fileName,
      params,
      fileSize: fileStatue.size,
      readyState: "pending",
    });
    DEBUG &&
      logger.warn(
        "Pending to Send File: " +
          JSON.stringify({
            fileName: fileObject.fileName,
            filePath: fileObject.filePath,
            fileSize: fileObject.fileSize,
            sessionId: fileObject.sessionId,
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
    readyState,
  }: {
    sessionId: number;
    fileName: string;
    filePath: string;
    params?: object;
    fileSize: number;
    readyState: ReceiveFileState;
  }) {
    super();
    this.sessionId = sessionId;
    this.fileName = fileName;
    this.filePath = filePath;
    this.params = params;
    this.fileSize = fileSize;
    this.readyState = readyState;
  }
  _changeReadyState(newState: ReceiveFileState) {
    this.readyState = newState;
    let event: ChangeEvent = {
      type: "readyStateChanged",
      data: {
        readyState: newState,
      },
      timestamp: new Date().getTime(),
    };
    this.emit("change", event);
  }
  /**
   * @prop Session identifier for transferring files. 传输文件的会话标识
   */
  sessionId: number;
  /**
   * @prop File name. 文件名
   */
  fileName: string;
  /**
   * @prop 	File path. 文件路径
   */
  filePath: string;
  /**
   * @prop User passed parameters. 自定义传递参数
   * @todo 官方文档为object，此处为object|undefined，取决于发送方是否传递了params
   */
  params?: object; // TODO 官方文档为object
  /**
   * @prop File size. 传输文件大小
   */
  fileSize: number;
  /**
   * @prop For the status value of the received file. 接收文件的状态值
   *  @see ReceiveFileState
   */
  readyState: ReceiveFileState;
  /**
   * @description Cancel a file transfer task. 取消传输文件任务
   */
  cancel(): void {
    // TODO
  }
  /**
   * @description Listen to the file transfer task event, event name reference FileEventName. 监听文件传输任务事件，事件名参考 FileEventName
   * @param eventName
   * @param callback
   */
  on(
    eventName: FileEventName,
    callback: ChangeCallback | ProgressCallback
  ): void {
    super.on(eventName, callback);
  }
}
