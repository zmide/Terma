import {filesServices} from '@/features/files/installed-services';
import {remoteServices} from '@/features/remote/installed-services';
import {h,mergeProps,type VNodeChild} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon as quickIcon} from '@/features/settings/settings-icon';
import {runDownloadLocationAction} from './download-location';
import type {TaskRecord} from './sftp-task-model';
export interface TaskCardPort {
 tr(key:string,values?:Record<string,unknown>):string;formatBytes(value:number):string;
 sftpJobProgress(job:TaskRecord):{percent:number}|null;sftpJobStatus(status:string,phase?:string):string;
 localizedSftpJobText(value?:string,key?:string):string;sftpJobProgressLabel(job:TaskRecord,progress:{percent:number}|null):string;
 localizedSftpJobIssue(job:TaskRecord,field:'error'|'delivery_error'|'warning'):string;sftpJobDisplayLabel(job:TaskRecord):string;
 ensureSftpTaskLogViewState(id:string):{expanded:boolean};
 openSftpGeneratedTaskFile(id:string,button?:EventTarget|null):unknown;
 openSftpGeneratedTaskDirectory(id:string,button?:EventTarget|null):unknown;
 deleteSftpGeneratedTaskFile(id:string,button?:EventTarget|null):unknown;
 retryCompletedSftpDownload(id:string,button?:EventTarget|null):unknown;
 saveSftpJobFile(id:string,button?:EventTarget|null):unknown;
}
export function renderSftpJob(scope:TaskCardPort,job:TaskRecord):VNodeChild {
    const syncJob = String(job.id || "").startsWith("sync:");
    const desktopJob = String(job.id || "").startsWith("desktop:");
    const componentJob = String(job.id || "").startsWith("component:");
    const done = job.status === "done";
    const running = job.status === "running";
    const paused = job.status === "paused";
    const pending = job.status === "pending";
    const cancelable = (running || paused || pending)
        && job.can_cancel !== false
        && !(job.type === "upload" && job.phase === "committing");
    const deletable = ["paused", "failed", "done", "cancelled"].includes(job.status);
    const resumable = Boolean(job.can_resume);
    const progressInfo = scope.sftpJobProgress(job);
    const progress = progressInfo?.percent || 0;
    const speed = running ? Number(job.speed_bps || 0) : Number(job.average_bps || 0);
    const amount = job.progress_unit === "percent"
        ? scope.localizedSftpJobText(job.current, job.current_i18n_key)
        : job.progress_unit === "items" && job.size
            ? scope.tr("tasks:auto.processed_items", {
                count: Number(job.size), completed: Math.min(Number(job.size), Number(job.transferred || 0)), total: Number(job.size), defaultValue: `已处理 ${Math.min(Number(job.size), Number(job.transferred || 0))} / ${Number(job.size)} 项`
            })
            : job.size
                ? `${scope.formatBytes(job.transferred || 0)} / ${scope.formatBytes(job.size)}`
                : scope.formatBytes(job.transferred || 0);
    const detail = [scope.sftpJobStatus(job.status, job.phase), amount, speed ? `${scope.formatBytes(speed)}/s${running ? "" : scope.tr("tasks:auto.average_suffix", {
            defaultValue: " 平均"
        })}` : "", scope.sftpJobProgressLabel(job, progressInfo)].filter(Boolean).join(" · ");
    const progressBar = ["running", "pending", "paused", "done", "failed"].includes(job.status) && progressInfo ? [h("div", {
            "class": "progress", "aria-label": [Math.round(progress), "%"].join('')
        }, [h("i", {
                "style": ["width:", progress, "%"].join('')
            }, [])])] : "";
    const jobIdArg = String(job.id || "");
    const rawSyncIdArg = String(job.raw_sync_id || "");
    const rawDesktopIdArg = String(job.raw_desktop_id || "");
    let downloadAction:VNodeChild = "";
    if (done && job.type === "local-generated" && job.delivery_status === "saved") {
        const openFile = scope.tr("tasks:actions.open_file", {
            defaultValue: "打开文件"
        });
        const openDirectory = scope.tr("tasks:actions.open_directory", {
            defaultValue: "打开目录"
        });
        const deleteFile = scope.tr("sftp:menu.delete_downloaded_file", {
            defaultValue: "删除文件"
        });
        downloadAction = [h(TermaButton, {
                "class": "icon-button primary sftp-task-icon-action", "type": "button", "title": openFile, "aria-label": openFile, "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.openSftpGeneratedTaskFile(jobIdArg, event.currentTarget); }
            }, {
                default: () => [quickIcon("external-link")]
            }), h(TermaButton, {
                "class": "icon-button sftp-task-icon-action", "type": "button", "title": openDirectory, "aria-label": openDirectory, "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.openSftpGeneratedTaskDirectory(jobIdArg); }
            }, {
                default: () => [quickIcon("folder-open")]
            }), h(TermaButton, {
                "class": "icon-button danger sftp-task-icon-action", "type": "button", "title": deleteFile, "aria-label": deleteFile, "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.deleteSftpGeneratedTaskFile(jobIdArg, event.currentTarget); }
            }, {
                default: () => [quickIcon("trash-2")]
            })];
    }
    else if (done && job.type === "local-generated") {
        downloadAction = [h(TermaButton, {
                "class": "primary", "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.openSftpGeneratedTaskFile(jobIdArg, event.currentTarget); }
            }, {
                default: () => [quickIcon("download"), h("span", {}, [scope.tr("tasks:actions.download_again", {
                            defaultValue: "再次下载"
                        })])]
            })];
    }
    else if (done && job.type === "download" && job.delivery_status === "saved") {
        const openFile = scope.tr("tasks:actions.open_file", {
            defaultValue: "打开文件"
        });
        const openDirectory = scope.tr("tasks:actions.open_directory", {
            defaultValue: "打开目录"
        });
        downloadAction = [h(TermaButton, {
                "class": "icon-button primary sftp-task-icon-action", "type": "button", "title": openFile, "aria-label": openFile, "onClick": (event:MouseEvent) => { event.stopPropagation(); void runDownloadLocationAction('open-file', jobIdArg, event.currentTarget as HTMLButtonElement); }
            }, {
                default: () => [quickIcon("external-link")]
            }), h(TermaButton, {
                "class": "icon-button sftp-task-icon-action", "type": "button", "title": openDirectory, "aria-label": openDirectory, "onClick": (event:MouseEvent) => { event.stopPropagation(); void runDownloadLocationAction('open-directory', jobIdArg); }
            }, {
                default: () => [quickIcon("folder-open")]
            })];
    }
    else if (done && job.type === "download" && ["delivered", "expired", "cache_cleared"].includes(job.delivery_status||'')) {
        downloadAction = [h(TermaButton, {
                "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.retryCompletedSftpDownload(jobIdArg, event.currentTarget); }
            }, {
                default: () => [quickIcon("download"), h("span", {}, [scope.tr("tasks:actions.download_again", {
                            defaultValue: "再次下载"
                        })])]
            })];
    }
    else if (done && job.type === "download") {
        downloadAction = [h(TermaButton, {
                "class": "primary", "onClick": (event:MouseEvent) => { event.stopPropagation(); scope.saveSftpJobFile(jobIdArg, event.currentTarget); }
            }, {
                default: () => [quickIcon("download"), h("span", {}, [scope.tr("tasks:actions.save_local", {
                            defaultValue: "保存到本机"
                        })])]
            })];
    }
    const resumeBtn = resumable ? [h(TermaButton, {
            "class": job.status === "failed" ? "primary" : "", "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.single(jobIdArg, 'resume', event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [job.status === "failed" ? scope.tr("tasks:actions.retry", {
                    defaultValue: "重试"
                }) : scope.tr("tasks:actions.resume", {
                    defaultValue: "继续"
                })]
        })] : "";
    const pauseBtn = running && job.resume_supported === true && job.can_pause !== false ? [h(TermaButton, {
            "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.single(jobIdArg, 'pause', event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [scope.tr("tasks:actions.pause", {
                    defaultValue: "暂停"
                })]
        })] : "";
    const cancelBtn = cancelable ? [h(TermaButton, {
            "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.single(jobIdArg, 'cancel', event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [scope.tr("common:actions.cancel", {
                    defaultValue: "取消"
                })]
        })] : "";
    const retrySyncBtn = syncJob && job.status === "failed" && job.type === "sync" ? [h(TermaButton, {
            "class": "primary", "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.sync(rawSyncIdArg, 'retry', event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [scope.tr("tasks:actions.retry_failed", {
                    defaultValue: "重试失败项"
                })]
        })] : "";
    const exportSyncBtn = syncJob && ["failed", "done", "cancelled"].includes(job.status) ? [h(TermaButton, {
            "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.sync(rawSyncIdArg, 'export', event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [quickIcon("download"), h("span", {}, [scope.tr("tasks:actions.export_result", {
                        defaultValue: "导出结果"
                    })])]
        })] : "";
    const desktopOpenBtn = desktopJob ? [h(TermaButton, {
            "onClick": (event:MouseEvent) => { event.stopPropagation(); void remoteServices.termaRemoteManagement.desktop.openTask(Number(job.connection_id), rawDesktopIdArg); }
        }, {
            default: () => [quickIcon("monitor-cog"), h("span", {}, [scope.tr("tasks:actions.view", {
                        defaultValue: "查看"
                    })])]
        })] : "";
    const deleteTask = scope.tr("tasks:actions.delete", {
        defaultValue: "删除任务"
    });
    const deleteBtn = deletable && !(job.type === "local-generated" && job.delivery_status === "saved") ? [h(TermaButton, {
            "class": "icon-button danger sftp-task-icon-action", "type": "button", "title": deleteTask, "aria-label": deleteTask, "onClick": (event:MouseEvent) => { event.stopPropagation(); filesServices.termaTaskActions.current.remove(jobIdArg, event.currentTarget as HTMLButtonElement); }
        }, {
            default: () => [quickIcon("trash-2")]
        })] : "";
    const finishedAt = job.finished_at ? h("time", {
            "datetime": Number.isFinite(new Date(job.finished_at).getTime())?new Date(job.finished_at).toISOString():undefined
        }, new Date(job.finished_at).toLocaleString(document.documentElement.lang)) : null;
    const deliveryText = job.saved_path ? [h("span", {
            "class": "sftp-job-delivery", "data-i18n-skip": true
        }, [scope.tr("tasks:notifications.saved_to", {
                path: job.saved_path, defaultValue: `已保存到 ${job.saved_path}`
            })])] : "";
    const renamedText = (Array.isArray(job.renamed_files) ? job.renamed_files : []).slice(0, 6).map((item) => [h("span", {
            "class": "sftp-job-delivery", "data-i18n-skip": true
        }, [scope.tr("tasks:notifications.file_renamed", {
                source: JSON.stringify(item.source), target: JSON.stringify(item.target)
            })])]);
    const deliveryErrorText = scope.localizedSftpJobIssue(job, "delivery_error");
    const transferWarningText = scope.localizedSftpJobIssue(job, "warning");
    const jobErrorText = scope.localizedSftpJobIssue(job, "error");
    const deliveryError = deliveryErrorText ? [h("div", {
            "class": "sftp-job-error"
        }, [h("strong", {}, [scope.tr("tasks:auto.auto_save_failed", {
                    defaultValue: "自动保存失败"
                })]), h("span", {
                "data-i18n-skip": true
            }, [deliveryErrorText.slice(0, 500)])])] : "";
    const transferWarning = transferWarningText ? [h("div", {
            "class": "sftp-job-warning"
        }, [h("strong", {}, [scope.tr("tasks:auto.transfer_notice", {
                    defaultValue: "传输提示"
                })]), h("span", {
                "data-i18n-skip": true
            }, [transferWarningText.slice(0, 500)])])] : "";
    const taskLogView = (desktopJob || componentJob) ? scope.ensureSftpTaskLogViewState(job.id) : null;
    const taskLog = taskLogView && job.logs?.length ? [h("details", mergeProps({
            "class": "global-task-log", "data-task-id": job.id
        }, (taskLogView.expanded ? {
            "open": true
        } : {})), [h("summary", {}, [scope.tr("tasks:auto.view_logs", {
                    defaultValue: "查看日志"
                })]), h("pre", {}, [job.logs.slice(-80).map((item) => `[${new Date(item.at || Date.now()).toLocaleTimeString()}] ${item.text || ""}`).join("\n")])])] : "";
    const currentText = scope.localizedSftpJobText(job.current, job.current_i18n_key);
    return [h("div", {
            "class": ["sftp-job ", job.status].join(''), "data-task-id": jobIdArg
        }, [h("div", { "class": "sftp-job-copy" }, [h("strong", {
                    "data-i18n-skip": true
                }, [scope.sftpJobDisplayLabel(job)]), h("span", {
                    "class": "sftp-job-summary", "data-i18n-skip": true
                }, [[job.connection_name, detail, job.progress_unit === "percent" ? "" : currentText].filter(Boolean).join(" · "), finishedAt ? [" · ", finishedAt] : null]), deliveryText, renamedText, progressBar, taskLog, transferWarning, deliveryError, jobErrorText ? [h("div", {
                        "class": "sftp-job-error"
                    }, [h("strong", {}, [scope.tr("tasks:auto.failure_reason", {
                                defaultValue: "失败原因"
                            })]), h("span", {
                            "data-i18n-skip": true
                        }, [jobErrorText.slice(0, 500)])])] : ""]), h("div", {
                "class": "actions tight"
            }, [downloadAction, resumeBtn, pauseBtn, retrySyncBtn, exportSyncBtn, desktopOpenBtn, cancelBtn, deleteBtn])])];
}
