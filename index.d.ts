/**
 * @class
 * Transfer File 文件传输
 */
export declare class TransferFile {
  /**
   * Get the receiving file object. 获取接收文件对象
   * @returns Receiving file object. 接收文件对象
   */
  getInbox(): Inbox;
  /**
   * Get the sending file object 获取发送文件对象
   * @returns Sending file object 发送文件对象
   */
  getOutbox(): Outbox;
}
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
/**
 * Receiving file object. 接收文件对象
 */
declare class Inbox {
  /**
   * Get a FileObject to receive the file object. 获取`FileObject`接收文件对象
   * @returns FileObject to receive the file object. `FileObject`接收文件对象
   */
  getNextFile(): FileObject;
  /**
   * Listening event, event name reference `InboxEventName`. 添加监听事件，事件名称参考 InboxEventName.
   * @param eventName Event name. 监听事件.
   * @param callback Callback function. 回调函数.
   */
  on(eventName: InboxEventName, callback: () => void): void;
}
/**
 * Sending file object. 发送文件对象.
 */
declare class Outbox {
  /**
   * Enqueue a file to sending quene. 添加文件至发送队列
   * @param fileName The path to the file.
   * @param params A customized file transfer object, retrieved from FileObject on the receiving end.
   * @returns Returns a `FileObject`. 返回`FileObject`文件发送对象
   */
  enqueueFile(fileName: string, params?: object): FileObject;
}

declare class FileObject {
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
  cancel(): void;
  /**
   * @description Listen to the file transfer task event, event name reference FileEventName. 监听文件传输任务事件，事件名参考 FileEventName
   * @param eventName
   * @param callback
   */
  on(
    eventName: FileEventName,
    callback: ChangeCallback | ProgressCallback
  ): void;
}
